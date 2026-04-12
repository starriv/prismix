import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { AuthError, getStrategy, resolveIdentity } from "@/server/auth";
import type { AuthProviderType } from "@/server/auth";
import { issueTokenPair, rotateRefreshToken } from "@/server/lib/auth-flows";
import { isProviderEnabled, listEnabledProviders } from "@/server/lib/auth-provider-config";
import {
  authAuthenticateBody,
  authInitializeBody,
  authLogoutBody,
  authRefreshBody,
} from "@/server/lib/body-schemas";
import { deleteRefreshToken } from "@/server/lib/jwt";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { adminAuthMiddleware, getAdminSession } from "@/server/middleware/auth";
import { authRateLimit } from "@/server/middleware/auth-rate-limit";
import { adminRepo } from "@/server/repos";

const adminAuth = new Hono();

// ── First-admin registration lock ────────────────────────────────────
// Serializes the first-admin TOCTOU check to prevent race conditions
// where multiple concurrent requests all see adminCount === 0.
let firstAdminLock: Promise<unknown> = Promise.resolve();

// ── Admin projection ─────────────────────────────────────────────────

function toAdminResponse(a: {
  id: number;
  address: string | null;
  name: string;
  email: string | null;
}) {
  return { id: a.id, address: a.address, name: a.name, email: a.email };
}

// GET /providers — list admin-enabled auth strategies
adminAuth.get("/providers", (c) => {
  return ok(c, { providers: listEnabledProviders() });
});

// POST /:provider/initialize — strategy init step (nonce / OAuth URL)
adminAuth.post("/:provider/initialize", authRateLimit("init"), async (c) => {
  const provider = c.req.param("provider") as AuthProviderType;
  if (!isProviderEnabled(provider)) return c.json({ error: "Provider not enabled" }, 400);
  try {
    const strategy = getStrategy(provider);
    if (!strategy.initialize) {
      return c.json({ error: `Strategy "${provider}" does not support initialize` }, 400);
    }
    const parsed = await parseBody(c, authInitializeBody);
    if (!parsed.ok) return parsed.response;
    const origin = c.req.header("Origin") || c.req.header("Referer");
    const result = await strategy.initialize({ ...parsed.data, scope: "admin", origin });
    return ok(c, result.data);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    log.admin.error({ err, provider }, "Initialize failed");
    return c.json({ error: "Initialization failed" }, 500);
  }
});

// POST /:provider/authenticate — verify credentials, issue JWT
adminAuth.post("/:provider/authenticate", authRateLimit("auth"), async (c) => {
  const provider = c.req.param("provider") as AuthProviderType;
  if (!isProviderEnabled(provider)) return c.json({ error: "Provider not enabled" }, 400);
  try {
    const strategy = getStrategy(provider);
    const parsed = await parseBody(c, authAuthenticateBody);
    if (!parsed.ok) return parsed.response;
    const origin = c.req.header("Origin") || c.req.header("Referer");
    const identity = await strategy.authenticate({ ...parsed.data, scope: "admin", origin });

    // First-admin auto-registration: serialized via lock to prevent
    // TOCTOU race where multiple requests all see adminCount === 0.
    const { userId } = await new Promise<{ userId: number }>((resolve, reject) => {
      firstAdminLock = firstAdminLock.then(async () => {
        try {
          const adminCount = (await adminRepo.findAll()).length;
          const result = await resolveIdentity(identity, "admin", {
            autoRegister: adminCount === 0,
            name: parsed.data.name,
          });
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
    const admin = await adminRepo.findById(userId);
    if (!admin) return c.json({ error: "Admin not found" }, 404);

    const tokens = await issueTokenPair(userId, admin.address ?? undefined, "admin");
    return ok(c, { ...tokens, admin: toAdminResponse(admin) });
  } catch (err) {
    if (err instanceof AuthError) {
      // Map account_not_found to the existing "not_admin" error for backward compat
      const msg = err.code === "account_not_found" ? "not_admin" : err.message;
      return c.json({ error: msg, code: err.code }, err.status as ContentfulStatusCode);
    }
    log.admin.error({ err, provider }, "Authenticate failed");
    return c.json({ error: "Authentication failed" }, 500);
  }
});

// Admin registration is disabled — admin accounts are created via seed SQL at system init.
// No POST /:provider/register route for admins.

// POST /refresh — exchange refresh token for a new access token
adminAuth.post("/refresh", authRateLimit("auth"), async (c) => {
  const parsed = await parseBody(c, authRefreshBody);
  if (!parsed.ok) return parsed.response;

  const tokens = await rotateRefreshToken(parsed.data.refreshToken, "admin");
  if (!tokens) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  return ok(c, tokens);
});

// GET /me — admin info (protected)
adminAuth.get("/me", adminAuthMiddleware, async (c) => {
  const session = getAdminSession(c);
  const admin = await adminRepo.findById(session.adminId);

  if (!admin) {
    return c.json({ error: "Admin not found" }, 404);
  }

  return ok(c, { admin: toAdminResponse(admin) });
});

// POST /logout — delete refresh token
adminAuth.post("/logout", adminAuthMiddleware, async (c) => {
  const parsed = await parseBody(c, authLogoutBody);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.refreshToken) {
    await deleteRefreshToken(parsed.data.refreshToken);
  }
  return ok(c, { success: true });
});

export default adminAuth;
