/**
 * Shared auth flow helpers — used by both user and admin auth routes.
 *
 * Extracts common patterns: SIWE verification, token issuance, refresh rotation.
 */
import { verifyMessage } from "viem";

import { consumeNonce, resolveSiweOrigin } from "../middleware/auth";
import { createRefreshToken, signAccessToken, validateRefreshToken } from "./jwt";

// ── SIWE signature verification (EIP-4361) ──────────────────────────

/**
 * Extract a field value from an EIP-4361 message by line prefix.
 * e.g. extractSiweField(msg, "Nonce:") → nonce value
 */
function extractSiweField(message: string, prefix: string): string | null {
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return null;
}

export async function verifySiweSignature(
  address: string,
  signature: string,
  message: string,
  scope: "user" | "admin",
  origin?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // 1. Consume the server-side nonce (single-use, scoped)
  const nonce = await consumeNonce(address, scope);
  if (!nonce) return { ok: false, reason: "Invalid or expired nonce" };

  // 2. Validate EIP-4361 message structure
  const msgNonce = extractSiweField(message, "Nonce:");
  if (msgNonce !== nonce) return { ok: false, reason: "Nonce mismatch" };

  // Verify the message addresses the correct account
  const lines = message.split("\n");
  const msgAddress = lines[1]?.trim();
  if (msgAddress?.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, reason: "Address mismatch in message" };
  }

  // Validate Chain ID (must be Base mainnet 8453)
  const msgChainId = extractSiweField(message, "Chain ID:");
  if (msgChainId !== "8453") {
    return { ok: false, reason: "Invalid Chain ID in message" };
  }

  // Derive expected origin fields from the same logic used to build the SIWE message.
  let expectedMessageOrigin: string;
  let expectedUri: string;
  try {
    ({ messageOrigin: expectedMessageOrigin, uri: expectedUri } = resolveSiweOrigin(origin));
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Invalid origin",
    };
  }

  // Validate requested origin — must match expected origin.
  const msgOrigin = lines[0]?.split(" wants you to sign in")[0];
  if (msgOrigin !== expectedMessageOrigin) {
    return { ok: false, reason: "Domain mismatch in message" };
  }

  // Validate URI — must match expected origin
  const msgUri = extractSiweField(message, "URI:");
  if (msgUri !== expectedUri) {
    return { ok: false, reason: "URI mismatch in message" };
  }

  // Validate Expiration Time — reject expired messages
  const msgExpiration = extractSiweField(message, "Expiration Time:");
  if (msgExpiration) {
    const expiresAt = new Date(msgExpiration).getTime();
    if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
      return { ok: false, reason: "Message has expired" };
    }
  }

  // 3. Verify cryptographic signature
  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });
  if (!valid) return { ok: false, reason: "Signature verification failed" };

  return { ok: true };
}

// ── Token issuance ──────────────────────────────────────────────────

export async function issueTokenPair(
  userId: number,
  address: string | undefined,
  role: "user" | "admin",
): Promise<{ token: string; refreshToken: string }> {
  const token = await signAccessToken({ userId, address, role });
  const refreshToken = await createRefreshToken(userId, address, role);
  return { token, refreshToken };
}

// ── Refresh token rotation ──────────────────────────────────────────

export async function rotateRefreshToken(
  rawRefreshToken: string,
  role: "user" | "admin",
): Promise<{ token: string; refreshToken: string } | null> {
  const result = await validateRefreshToken(rawRefreshToken, role);
  if (!result) return null;

  const token = await signAccessToken({
    userId: result.userId,
    address: result.address,
    role,
  });
  const refreshToken = await createRefreshToken(result.userId, result.address, role);
  return { token, refreshToken };
}
