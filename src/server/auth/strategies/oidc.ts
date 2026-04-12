import crypto from "crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { createCacheStore } from "@/server/cache";
import { getProviderCredentials, getProviderFullConfig } from "@/server/lib/auth-provider-config";
import { log } from "@/server/lib/logger";

import type { AuthIdentity, AuthStrategy, InitializeResult } from "../strategy";
import { AuthError } from "../strategy";

// ── Types ──────────────────────────────────────────────────────────

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
}

interface OidcTokenResponse {
  id_token?: string;
  access_token?: string;
  token_type?: string;
}

interface OidcIdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  nonce?: string;
  [key: string]: unknown;
}

// ── State cache (CSRF + nonce) ─────────────────────────────────────

const STATE_TTL = 5 * 60 * 1000; // 5min
const stateCache = createCacheStore<{ scope: string; nonce: string }>("oidc-state");

// ── Discovery cache ────────────────────────────────────────────────

const DISCOVERY_TTL = 60 * 60 * 1000; // 1h
let discoveryCache: OidcDiscovery | null = null;
let discoveryCachedAt = 0;

async function discover(issuer: string): Promise<OidcDiscovery> {
  if (discoveryCache && Date.now() - discoveryCachedAt < DISCOVERY_TTL) {
    return discoveryCache;
  }

  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    log.auth.error({ status: res.status, issuer }, "OIDC discovery fetch failed");
    throw new AuthError("OIDC discovery failed", "provider_error", 502);
  }

  discoveryCache = (await res.json()) as OidcDiscovery;
  discoveryCachedAt = Date.now();
  return discoveryCache;
}

/** Reset discovery cache — exposed for testing */
export function resetDiscoveryCache(): void {
  discoveryCache = null;
  discoveryCachedAt = 0;
}

// ── Strategy ────────────────────────────────────────────────────────

export class OidcStrategy implements AuthStrategy {
  readonly name = "oidc" as const;

  private get config() {
    const full = getProviderFullConfig("oidc");
    if (!full.issuer) {
      throw new AuthError("OIDC issuer not configured", "provider_error", 500);
    }
    const creds = getProviderCredentials("oidc");
    if (!creds.clientId || !creds.clientSecret) {
      throw new AuthError("OIDC client credentials not configured", "provider_error", 500);
    }
    return { ...full, clientId: creds.clientId, clientSecret: creds.clientSecret };
  }

  private get callbackUrl(): string {
    const origin =
      process.env.CORS_ORIGIN || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : undefined);
    if (!origin)
      throw new AuthError("CORS_ORIGIN or DOMAIN env var is required", "provider_error", 500);
    return `${origin}/api/auth/callback/oidc`;
  }

  async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const cfg = this.config;
    const discovery = await discover(cfg.issuer!);
    const scope = (params.scope as string) || "user";

    const state = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    stateCache.set(state, { scope, nonce }, STATE_TTL);

    const scopes = ["openid", "email", "profile", ...(cfg.scopes ?? [])];
    const searchParams = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.callbackUrl,
      response_type: "code",
      scope: scopes.join(" "),
      state,
      nonce,
    });

    const url = `${discovery.authorization_endpoint}?${searchParams.toString()}`;
    return { data: { url } };
  }

  async authenticate(params: Record<string, unknown>): Promise<AuthIdentity> {
    const code = params.code as string;
    const state = params.state as string;

    if (!code || !state) {
      throw new AuthError("Authorization code and state are required", "invalid_credentials", 400);
    }

    const cfg = this.config;
    const discovery = await discover(cfg.issuer!);

    // 1. Validate CSRF state
    const stored = stateCache.get(state);
    if (!stored) {
      throw new AuthError("Invalid or expired OIDC state", "nonce_expired");
    }
    stateCache.del(state);

    // 2. Exchange code for tokens
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: this.callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      log.auth.error({ status: tokenRes.status, err }, "OIDC token exchange failed");
      throw new AuthError("OIDC token exchange failed", "provider_error");
    }

    const tokenData = (await tokenRes.json()) as OidcTokenResponse;

    if (!tokenData.id_token) {
      throw new AuthError("OIDC provider did not return an ID token", "provider_error");
    }

    // 3. Verify ID Token
    const claims = await this.verifyIdToken(tokenData.id_token, stored.nonce, discovery, cfg);

    // 4. Optional: supplement profile from userinfo endpoint
    let profile = {
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
    };

    if (discovery.userinfo_endpoint && tokenData.access_token) {
      try {
        const userRes = await fetch(discovery.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userRes.ok) {
          const userInfo = (await userRes.json()) as Record<string, unknown>;
          profile = {
            sub: profile.sub,
            email: (userInfo.email as string) ?? profile.email,
            name: (userInfo.name as string) ?? profile.name,
            picture: (userInfo.picture as string) ?? profile.picture,
          };
        }
      } catch {
        // userinfo is optional — continue with ID token claims
      }
    }

    return {
      provider: "oidc",
      providerAccountId: profile.sub,
      profile: {
        email: profile.email,
        name: profile.name,
        avatar: profile.picture,
      },
    };
  }

  private async verifyIdToken(
    idToken: string,
    expectedNonce: string,
    discovery: OidcDiscovery,
    cfg: { clientId: string; issuer?: string },
  ): Promise<OidcIdTokenClaims> {
    const JWKS = createRemoteJWKSet(new URL(discovery.jwks_uri));
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: discovery.issuer,
      audience: cfg.clientId,
    });

    if (payload.nonce !== expectedNonce) {
      throw new AuthError("ID token nonce mismatch", "signature_invalid");
    }

    if (!payload.sub) {
      throw new AuthError("ID token missing sub claim", "provider_error");
    }

    return payload as unknown as OidcIdTokenClaims;
  }
}

/** Verify an OIDC state token and return the stored scope */
export function consumeOidcState(state: string): string | null {
  const stored = stateCache.get(state);
  if (!stored) return null;
  stateCache.del(state);
  return stored.scope;
}
