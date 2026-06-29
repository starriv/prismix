import crypto from "crypto";

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { match } from "ts-pattern";

import {
  consumeEphemeralState,
  countEphemeralState,
  setEphemeralState,
} from "../lib/ephemeral-state";
import { verifyAccessToken } from "../lib/jwt";
import { ApiKeyAuthStrategy } from "./auth-strategies/api-key";
import { JwtAuthStrategy } from "./auth-strategies/jwt";
import type { AuthMiddlewareStrategy, AuthResult } from "./auth-strategies/strategy";

// ── Nonce store ────────────────────────────────────────────────────

const NONCE_TTL = 5 * 60 * 1000; // 5min
const NONCE_NAMESPACE = "nonce";

/**
 * Create a nonce for an address. The `scope` parameter isolates user
 * and admin nonces so that a nonce requested for one cannot be consumed
 * by the other (prevents cross-scope nonce hijacking).
 */
export async function createNonce(
  address: string,
  scope: "user" | "admin" = "user",
): Promise<string> {
  const nonce = crypto.randomBytes(16).toString("hex");
  const key = `${scope}:${address.toLowerCase()}`;
  await setEphemeralState(NONCE_NAMESPACE, key, nonce, NONCE_TTL);
  return nonce;
}

export async function consumeNonce(
  address: string,
  scope: "user" | "admin" = "user",
): Promise<string | null> {
  const key = `${scope}:${address.toLowerCase()}`;
  return (await consumeEphemeralState<string>(NONCE_NAMESPACE, key)) ?? null;
}

/**
 * Build an EIP-4361 compliant SIWE message.
 */
export function buildSiweMessage(address: string, nonce: string, origin?: string): string {
  const { messageOrigin, uri } = resolveSiweOrigin(origin);

  const chainId = 8453; // Base mainnet
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + NONCE_TTL).toISOString();

  return [
    `${messageOrigin} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to Prismix",
    "",
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join("\n");
}

export function resolveSiweOrigin(origin?: string): { messageOrigin: string; uri: string } {
  const configuredOrigin = origin ?? process.env.CORS_ORIGIN;
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      return {
        messageOrigin: shouldUseFullLocalOrigin(parsed) ? parsed.origin : parsed.host,
        uri: parsed.origin,
      };
    } catch {
      throw new Error(
        origin ? "Invalid origin for SIWE message" : "Invalid CORS_ORIGIN configuration",
      );
    }
  }

  if (process.env.NODE_ENV !== "production" && process.env.VITE_DEV_PORT) {
    const uri = `http://localhost:${process.env.VITE_DEV_PORT}`;
    return { messageOrigin: uri, uri };
  }

  if (process.env.DOMAIN) {
    return {
      messageOrigin: process.env.DOMAIN,
      uri: `https://${process.env.DOMAIN}`,
    };
  }

  throw new Error("Missing origin — set CORS_ORIGIN or DOMAIN");
}

function shouldUseFullLocalOrigin(origin: URL): boolean {
  if (process.env.NODE_ENV === "production" || origin.protocol !== "http:") return false;

  const hostname = origin.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export async function getNonceCount(): Promise<number> {
  return countEphemeralState(NONCE_NAMESPACE);
}

// ── Credential extraction (multi-source) ────────────────────────────

function extractCredential(c: Context): string | null {
  // 1. X-API-Key header — most explicit, highest priority
  const apiKeyHeader = c.req.header("X-API-Key")?.trim();
  if (apiKeyHeader) return apiKeyHeader;

  const authHeader = c.req.header("Authorization");
  if (!authHeader) return null;

  const raw = match(authHeader)
    .when(
      (h) => h.startsWith("Basic "),
      (h) => decodeBasicAuth(h.slice(6)),
    )
    .when(
      (h) => h.startsWith("Bearer "),
      (h) => h.slice(7) || null,
    )
    .otherwise(() => null);

  // Normalize: trim whitespace, convert empty strings to null
  const trimmed = raw?.trim();
  return trimmed || null;
}

function decodeBasicAuth(encoded: string): string | null {
  try {
    const decoded = atob(encoded);
    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) return decoded;
    return decoded.slice(colonIdx + 1) || null;
  } catch {
    return null;
  }
}

/**
 * Run a token through a strategy chain.
 */
async function runStrategies(
  strategies: AuthMiddlewareStrategy[],
  token: string,
): Promise<AuthResult | null> {
  for (const strategy of strategies) {
    if (strategy.canHandle(token)) {
      return strategy.authenticate(token);
    }
  }
  return null;
}

// ── Admin auth middleware (JWT + API Key) ──────────────────────────

export interface AdminSession {
  adminId: number;
  address?: string;
  source: "jwt" | "api_key";
  keyId?: number;
}

type AdminEnv = {
  Variables: {
    admin: AdminSession;
  };
};

// Admin uses JWT + API Key — strategy chain matches both
const adminStrategies: AuthMiddlewareStrategy[] = [new ApiKeyAuthStrategy(), new JwtAuthStrategy()];

export const adminAuthMiddleware = createMiddleware<AdminEnv>(async (c, next) => {
  const token = extractCredential(c);
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const result = await runStrategies(adminStrategies, token);
  if (!result) return c.json({ error: "Unauthorized" }, 401);

  c.set("admin", {
    adminId: result.adminId,
    address: result.address,
    source: result.source,
    keyId: result.keyId,
  });
  await next();
});

/** Type-safe accessor for the admin session set by adminAuthMiddleware. */
export function getAdminSession(c: Context): AdminSession {
  return c.get("admin" as never) as AdminSession;
}

// ── User auth middleware (JWT only) ──────────────────────────────

export interface UserSession {
  userId: number;
  address?: string;
}

type UserEnv = {
  Variables: {
    user: UserSession;
  };
};

export const userAuthMiddleware = createMiddleware<UserEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const payload = await verifyAccessToken(token);
  if (!payload || payload.role !== "user") return c.json({ error: "Unauthorized" }, 401);
  const userId = Number(payload.sub);
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: "Unauthorized" }, 401);

  c.set("user", {
    userId,
    address: payload.address,
  });
  await next();
});

/** Type-safe accessor for the user session set by userAuthMiddleware. */
export function getUserSession(c: Context): UserSession {
  return c.get("user" as never) as UserSession;
}

// ── SSE token verification helpers ───────────────────────────────

export async function verifyTokenForSSE(
  raw: string,
): Promise<{ role: "admin" | "user"; userId: number } | null> {
  const payload = await verifyAccessToken(raw);
  if (!payload) return null;
  if (payload.role === "admin" || payload.role === "user") {
    const userId = Number(payload.sub);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { role: payload.role, userId };
  }
  return null;
}
