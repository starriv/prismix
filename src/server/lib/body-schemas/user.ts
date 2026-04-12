/**
 * User/Auth Zod body schemas: authentication, profile, identity binding, API keys.
 */
import { z } from "zod";

// ── Auth ────────────────────────────────────────────────────────────────

/** Body for auth initialize (nonce/OAuth URL generation) */
export const authInitializeBody = z.object({
  address: z.string().optional(),
  email: z.string().email().optional(),
  redirect: z.string().url().optional(),
});

/** Body for auth authenticate (credential verification) */
export const authAuthenticateBody = z.object({
  // SIWE fields
  address: z.string().optional(),
  message: z.string().optional(),
  signature: z.string().optional(),
  // Credentials fields
  email: z.string().optional(),
  password: z.string().optional(),
  name: z.string().max(100).optional(),
  network: z.string().optional(),
  // OAuth callback fields
  code: z.string().optional(),
  state: z.string().optional(),
});

/** Body for auth register (new account) */
export const authRegisterBody = z.object({
  address: z.string().optional(),
  message: z.string().optional(),
  signature: z.string().optional(),
  email: z.string().optional(),
  password: z.string().optional(),
  name: z.string().max(100).optional(),
  network: z.string().optional(),
});

/** Body for token refresh */
export const authRefreshBody = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

/** Body for OAuth exchange */
export const authExchangeBody = z.object({
  code: z.string().min(1, "code is required"),
});

/** Body for logout */
export const authLogoutBody = z.object({
  refreshToken: z.string().optional(),
});

// ── User Profile ────────────────────────────────────────────────────

export const updateProfileBody = z.object({
  name: z.string().min(1, "common.valid.required").max(100).optional(),
  avatar: z.string().url("common.valid.invalid-url").max(500).optional(),
});

// ── API Key ─────────────────────────────────────────────────────────

export const createApiKeyBody = z.object({
  name: z.string().min(1, "Name is required").max(100),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const updateApiKeyBody = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

// ── Identity Bind ──────────────────────────────────────────────────

export const bindIdentityBody = z.object({
  provider: z.string().min(1, "Provider is required").max(50),
  providerAccountId: z.string().min(1, "Provider account ID is required").max(200),
  profileData: z.record(z.string(), z.unknown()).optional(),
});
