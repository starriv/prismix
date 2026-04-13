import crypto from "crypto";

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { AuthError, getStrategy, resolveIdentity } from "@/server/auth";
import type { AuthProviderType } from "@/server/auth";
import { SamlStrategy } from "@/server/auth/strategies/saml";
import { lazyCacheStore } from "@/server/cache";
import { issueTokenPair, rotateRefreshToken } from "@/server/lib/auth-flows";
import { isProviderEnabled, listEnabledProviders } from "@/server/lib/auth-provider-config";
import {
  authAuthenticateBody,
  authExchangeBody,
  authInitializeBody,
  authLogoutBody,
  authRefreshBody,
  authRegisterBody,
} from "@/server/lib/body-schemas";
import { deleteRefreshToken } from "@/server/lib/jwt";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getUserSession, userAuthMiddleware } from "@/server/middleware/auth";
import { authRateLimit } from "@/server/middleware/auth-rate-limit";
import { networkRepo, userRepo } from "@/server/repos";

// ── One-time exchange code cache (OAuth callback → token pair) ────────
// Stores token pairs keyed by a random code (30s TTL).
// Frontend uses POST /exchange to swap the code for tokens.
const EXCHANGE_TTL = 30 * 1000; // 30 seconds
const exchangeCache = lazyCacheStore<{ token: string; refreshToken: string; userId: number }>(
  "oauth-exchange",
);

const auth = new Hono();

// ── User projection (shared shape for all user responses) ────

function toUserResponse(u: {
  id: number;
  uuid: string | null;
  address: string | null;
  name: string;
  email: string | null;
  avatar: string | null;
  status: number;
}) {
  return {
    id: u.id,
    uuid: u.uuid,
    address: u.address,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    status: u.status,
  };
}

// GET /providers — list admin-enabled auth strategies
auth.get("/providers", (c) => {
  return ok(c, { providers: listEnabledProviders() });
});

// POST /:provider/initialize — strategy init step (nonce / OAuth URL)
auth.post("/:provider/initialize", authRateLimit("init"), async (c) => {
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
    const result = await strategy.initialize({ ...parsed.data, scope: "user", origin });
    return ok(c, result.data);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    log.auth.error({ err, provider }, "Initialize failed");
    return c.json({ error: "Initialization failed" }, 500);
  }
});

// POST /:provider/authenticate — verify credentials, issue JWT
auth.post("/:provider/authenticate", authRateLimit("auth"), async (c) => {
  const provider = c.req.param("provider") as AuthProviderType;
  if (!isProviderEnabled(provider)) return c.json({ error: "Provider not enabled" }, 400);
  try {
    const strategy = getStrategy(provider);
    const parsed = await parseBody(c, authAuthenticateBody);
    if (!parsed.ok) return parsed.response;
    const origin = c.req.header("Origin") || c.req.header("Referer");
    const identity = await strategy.authenticate({ ...parsed.data, scope: "user", origin });

    const { userId } = await resolveIdentity(identity, "user", { autoRegister: true });
    const user = await userRepo.findById(userId);
    if (!user) return c.json({ error: "User not found" }, 404);

    const tokens = await issueTokenPair(userId, user.address ?? undefined, "user");
    return ok(c, { ...tokens, user: toUserResponse(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
    }
    log.auth.error({ err, provider }, "Authenticate failed");
    return c.json({ error: "Authentication failed" }, 500);
  }
});

// POST /:provider/register — register new user via strategy
auth.post("/:provider/register", authRateLimit("auth"), async (c) => {
  const provider = c.req.param("provider") as AuthProviderType;
  if (!isProviderEnabled(provider)) return c.json({ error: "Provider not enabled" }, 400);
  try {
    const strategy = getStrategy(provider);
    const parsed = await parseBody(c, authRegisterBody);
    if (!parsed.ok) return parsed.response;

    // Use strategy's register method if available, otherwise authenticate
    const origin = c.req.header("Origin") || c.req.header("Referer");
    const identity = strategy.register
      ? await strategy.register({ ...parsed.data, scope: "user", origin })
      : await strategy.authenticate({ ...parsed.data, scope: "user", origin });

    // Resolve identity with auto-register enabled
    const { userId } = await resolveIdentity(identity, "user", {
      autoRegister: true,
      name: parsed.data.name,
    });

    const user = await userRepo.findById(userId);
    if (!user) return c.json({ error: "User not found" }, 404);

    const tokens = await issueTokenPair(userId, user.address ?? undefined, "user");
    return ok(c, { ...tokens, user: toUserResponse(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = (err.code === "account_exists" ? 409 : err.status) as ContentfulStatusCode;
      return c.json({ error: err.message, code: err.code }, status);
    }
    log.auth.error({ err, provider }, "Register failed");
    return c.json({ error: "Registration failed" }, 500);
  }
});

// POST /refresh — exchange refresh token for a new access token
auth.post("/refresh", authRateLimit("auth"), async (c) => {
  const parsed = await parseBody(c, authRefreshBody);
  if (!parsed.ok) return parsed.response;

  const tokens = await rotateRefreshToken(parsed.data.refreshToken, "user");
  if (!tokens) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  return ok(c, tokens);
});

// GET /me — get current user
auth.get("/me", userAuthMiddleware, async (c) => {
  const session = getUserSession(c);
  const user = await userRepo.findById(session.userId);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return ok(c, { user: toUserResponse(user) });
});

// POST /logout — invalidate refresh token
auth.post("/logout", userAuthMiddleware, async (c) => {
  const parsed = await parseBody(c, authLogoutBody);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.refreshToken) {
    await deleteRefreshToken(parsed.data.refreshToken);
  }
  return ok(c, { success: true });
});

// GET /callback/:provider — OAuth redirect callback
// Google/GitHub redirects back here with ?code=xxx&state=yyy
// Server verifies, resolves identity, stores token pair in one-time cache,
// then redirects to frontend /auth/callback?code=zzz
auth.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider") as AuthProviderType;
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  const frontendOrigin = process.env.CORS_ORIGIN;
  if (!frontendOrigin) {
    log.auth.error("CORS_ORIGIN env var is required for OAuth callbacks");
    return c.json({ error: "Server misconfiguration: CORS_ORIGIN not set" }, 500);
  }

  if (error) {
    return c.redirect(`${frontendOrigin}/auth/callback?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return c.redirect(`${frontendOrigin}/auth/callback?error=missing_params`);
  }

  try {
    const strategy = getStrategy(provider);
    const identity = await strategy.authenticate({ code, state, scope: "user" });

    // Auto-register OAuth users (no separate registration step)
    const { userId } = await resolveIdentity(identity, "user", {
      autoRegister: true,
      name: identity.profile?.name,
    });

    const user = await userRepo.findById(userId);
    if (!user) {
      return c.redirect(`${frontendOrigin}/auth/callback?error=user_not_found`);
    }

    const tokens = await issueTokenPair(userId, user.address ?? undefined, "user");

    // Store token pair in one-time exchange cache
    const exchangeCode = crypto.randomBytes(16).toString("hex");
    exchangeCache.set(exchangeCode, { ...tokens, userId }, EXCHANGE_TTL);

    return c.redirect(`${frontendOrigin}/auth/callback?code=${exchangeCode}`);
  } catch (err) {
    log.auth.error({ err, provider }, "OAuth callback failed");
    const msg = err instanceof AuthError ? err.message : "oauth_failed";
    return c.redirect(`${frontendOrigin}/auth/callback?error=${encodeURIComponent(msg)}`);
  }
});

// POST /exchange — swap one-time code for token pair (used after OAuth callback)
auth.post("/exchange", authRateLimit("auth"), async (c) => {
  const parsed = await parseBody(c, authExchangeBody);
  if (!parsed.ok) return parsed.response;

  const cached = exchangeCache.get(parsed.data.code);
  if (!cached) {
    return c.json({ error: "Invalid or expired exchange code" }, 401);
  }
  exchangeCache.del(parsed.data.code); // single-use

  const user = await userRepo.findById(cached.userId);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return ok(c, {
    token: cached.token,
    refreshToken: cached.refreshToken,
    user: toUserResponse(user),
  });
});

// ── SAML-specific routes ─────────────────────────────────────────

// GET /saml/metadata — SP metadata XML (public, for IdP admins)
auth.get("/saml/metadata", (c) => {
  try {
    const strategy = getStrategy("saml") as SamlStrategy;
    const xml = strategy.generateMetadata();
    return c.newResponse(xml, 200, { "Content-Type": "application/xml" });
  } catch (err) {
    log.auth.error({ err }, "Failed to generate SAML SP metadata");
    return c.json({ error: "SAML not configured" }, 500);
  }
});

// POST /callback/saml — SAML ACS (IdP posts SAMLResponse via browser form)
auth.post("/callback/saml", async (c) => {
  const frontendOrigin = process.env.CORS_ORIGIN;
  if (!frontendOrigin) {
    log.auth.error("CORS_ORIGIN env var is required for SAML callbacks");
    return c.json({ error: "Server misconfiguration: CORS_ORIGIN not set" }, 500);
  }

  try {
    const body = await c.req.parseBody();
    const samlResponse = body.SAMLResponse as string;
    const relayState = body.RelayState as string;

    if (!samlResponse) {
      return c.redirect(`${frontendOrigin}/auth/callback?error=missing_saml_response`);
    }

    const strategy = getStrategy("saml");
    const identity = await strategy.authenticate({
      SAMLResponse: samlResponse,
      RelayState: relayState,
    });

    const { userId } = await resolveIdentity(identity, "user", {
      autoRegister: true,
      name: identity.profile?.name,
    });

    const user = await userRepo.findById(userId);
    if (!user) {
      return c.redirect(`${frontendOrigin}/auth/callback?error=user_not_found`);
    }

    const tokens = await issueTokenPair(userId, user.address ?? undefined, "user");

    const exchangeCode = crypto.randomBytes(16).toString("hex");
    exchangeCache.set(exchangeCode, { ...tokens, userId }, EXCHANGE_TTL);

    return c.redirect(`${frontendOrigin}/auth/callback?code=${exchangeCode}`);
  } catch (err) {
    log.auth.error({ err }, "SAML callback failed");
    const msg = err instanceof AuthError ? err.message : "saml_failed";
    return c.redirect(`${frontendOrigin}/auth/callback?error=${encodeURIComponent(msg)}`);
  }
});

// GET /networks — public, enabled networks with names from DB
auth.get("/networks", async (c) => {
  const all = await networkRepo.findEnabledNetworks();
  return ok(c, all);
});

// GET /allowed-tokens — public, no auth required
auth.get("/allowed-tokens", async (c) => {
  return ok(c, await networkRepo.findAllowedTokens());
});

export default auth;
