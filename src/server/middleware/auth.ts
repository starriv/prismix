import crypto from "crypto";

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { match } from "ts-pattern";

import { createCacheStore } from "../cache";
import { verifyAccessToken } from "../lib/jwt";
import { ApiKeyAuthStrategy } from "./auth-strategies/api-key";
import { JwtAuthStrategy } from "./auth-strategies/jwt";
import type { AuthMiddlewareStrategy, AuthResult } from "./auth-strategies/strategy";

// ── Nonce store ────────────────────────────────────────────────────

const NONCE_TTL = 5 * 60 * 1000; // 5min
const nonceStore = createCacheStore<string>("nonce");

/**
 * Create a nonce for an address. The `scope` parameter isolates user
 * and admin nonces so that a nonce requested for one cannot be consumed
 * by the other (prevents cross-scope nonce hijacking).
 */
export function createNonce(address: string, scope: "user" | "admin" = "user"): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const key = `${scope}:${address.toLowerCase()}`;
  nonceStore.set(key, nonce, NONCE_TTL);
  return nonce;
}

export function consumeNonce(address: string, scope: "user" | "admin" = "user"): string | null {
  const key = `${scope}:${address.toLowerCase()}`;
  const nonce = nonceStore.get(key);
  if (nonce === undefined) return null;
  nonceStore.del(key); // single-use
  return nonce;
}

/**
 * Build an EIP-4361 compliant SIWE message.
 */
export function buildSiweMessage(address: string, nonce: string, origin?: string): string {
  let domain: string;
  let uri: string;

  if (origin) {
    try {
      const parsed = new URL(origin);
      domain = parsed.hostname;
      uri = parsed.origin;
    } catch {
      throw new Error("Invalid origin for SIWE message");
    }
  } else if (process.env.CORS_ORIGIN) {
    try {
      const parsed = new URL(process.env.CORS_ORIGIN);
      domain = parsed.hostname;
      uri = parsed.origin;
    } catch {
      throw new Error("Invalid CORS_ORIGIN configuration");
    }
  } else if (process.env.DOMAIN) {
    domain = process.env.DOMAIN;
    uri = `https://${process.env.DOMAIN}`;
  } else {
    throw new Error("Missing origin — set CORS_ORIGIN or DOMAIN");
  }

  const chainId = 8453; // Base mainnet
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + NONCE_TTL).toISOString();

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
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

export function getNonceCount(): number {
  return nonceStore.size();
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
