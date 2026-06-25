import crypto from "crypto";

import { jwtVerify, SignJWT } from "jose";
import type { JWTPayload } from "jose";

import { getNonceCount } from "../middleware/auth";
import { refreshTokenRepo } from "../repos";

// ── Constants ──────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const JWT_ISSUER = "prismix";
const JWT_AUDIENCE = "prismix";

// ── Secret ─────────────────────────────────────────────────────────

let secretKey: Uint8Array;

export function initJwtSecret(): void {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    throw new Error("JWT_SECRET must be set before calling initJwtSecret");
  }
  secretKey = new TextEncoder().encode(raw);
}

// ── JWT Claims ─────────────────────────────────────────────────────

export interface AccessTokenPayload extends JWTPayload {
  sub: string; // userId as string
  address?: string; // optional — Web2 users have no wallet address
  role: "user" | "admin";
}

// ── Access Token (JWT, short-lived) ────────────────────────────────

export async function signAccessToken(payload: {
  userId: number;
  address?: string;
  role: "user" | "admin";
}): Promise<string> {
  const claims: Record<string, unknown> = { role: payload.role };
  if (payload.address) claims.address = payload.address;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

// ── Refresh Token (opaque, stored hashed in DB) ────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createRefreshToken(
  userId: number,
  address: string | undefined,
  role: "user" | "admin",
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await refreshTokenRepo.create({
    tokenHash: hash,
    userId,
    role,
    address: address ?? "",
    expiresAt,
  });

  return raw;
}

/**
 * Validate and consume a refresh token (single-use rotation).
 * Uses atomic DELETE ... RETURNING to prevent TOCTOU race — only one
 * concurrent caller can successfully consume a given token.
 * Caller must issue a new one via createRefreshToken().
 */
export async function validateRefreshToken(
  raw: string,
  role: "user" | "admin",
): Promise<{ userId: number; address: string | undefined } | null> {
  const hash = hashToken(raw);

  // Atomic: DELETE + RETURNING in one statement — no race window
  const row = await refreshTokenRepo.consumeByHashAndRole(hash, role);

  if (!row) return null;

  if (Date.now() > row.expiresAt.getTime()) {
    return null; // expired (already deleted, which is fine — expired tokens should be removed)
  }

  return { userId: row.userId, address: row.address || undefined };
}

export async function deleteRefreshToken(raw: string): Promise<void> {
  const hash = hashToken(raw);
  await refreshTokenRepo.deleteByHash(hash);
}

export async function deleteAllRefreshTokens(
  userId: number,
  role: "user" | "admin",
): Promise<void> {
  await refreshTokenRepo.deleteByUser(userId, role);
}

// ── Cleanup (call on startup) ──────────────────────────────────────

export async function cleanExpiredRefreshTokens(): Promise<number> {
  return refreshTokenRepo.cleanExpired();
}

// ── Stats (for /metrics) ───────────────────────────────────────────

export async function getJwtStats() {
  const [userCount, adminCount, pendingNonces] = await Promise.all([
    refreshTokenRepo.countByRole("user"),
    refreshTokenRepo.countByRole("admin"),
    getNonceCount(),
  ]);

  return {
    userRefreshTokens: userCount,
    adminRefreshTokens: adminCount,
    pendingNonces,
  };
}
