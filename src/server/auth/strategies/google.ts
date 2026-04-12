import crypto from "crypto";

import { createCacheStore } from "@/server/cache";
import { getProviderCredentials } from "@/server/lib/auth-provider-config";

import type { AuthIdentity, AuthStrategy, InitializeResult } from "../strategy";
import { AuthError } from "../strategy";

// ── OAuth state cache (CSRF protection) ─────────────────────────────

const STATE_TTL = 5 * 60 * 1000; // 5min
const stateCache = createCacheStore<string>("google-oauth-state");

export class GoogleAuthStrategy implements AuthStrategy {
  readonly name = "google" as const;

  private get credentials() {
    const creds = getProviderCredentials("google");
    if (!creds.clientId || !creds.clientSecret) {
      throw new AuthError("Google OAuth not configured", "provider_error", 500);
    }
    return creds;
  }

  private get callbackUrl(): string {
    const origin =
      process.env.CORS_ORIGIN || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : undefined);
    if (!origin)
      throw new AuthError("CORS_ORIGIN or DOMAIN env var is required", "provider_error", 500);
    return `${origin}/api/auth/callback/google`;
  }

  async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const scope = (params.scope as string) || "user";
    const state = crypto.randomBytes(16).toString("hex");
    stateCache.set(state, scope, STATE_TTL);

    const searchParams = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: this.callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "consent",
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${searchParams.toString()}`;
    return { data: { url } };
  }

  async authenticate(params: Record<string, unknown>): Promise<AuthIdentity> {
    const code = params.code as string;
    const state = params.state as string;

    if (!code || !state) {
      throw new AuthError("Authorization code and state are required", "invalid_credentials", 400);
    }

    // Validate CSRF state
    const storedScope = stateCache.get(state);
    if (!storedScope) {
      throw new AuthError("Invalid or expired OAuth state", "nonce_expired");
    }
    stateCache.del(state);

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        redirect_uri: this.callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      throw new AuthError(`Google token exchange failed: ${err}`, "provider_error");
    }

    const tokenData = (await tokenResponse.json()) as { id_token?: string; access_token?: string };

    // Fetch user info
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new AuthError("Failed to fetch Google user info", "provider_error");
    }

    const profile = (await userInfoResponse.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    if (!profile.sub) {
      throw new AuthError("Google did not return a user ID", "provider_error");
    }

    return {
      provider: "google",
      providerAccountId: profile.sub,
      profile: {
        email: profile.email,
        name: profile.name,
        avatar: profile.picture,
      },
    };
  }
}

/** Verify a Google OAuth state token and return the stored scope */
export function consumeGoogleState(state: string): string | null {
  const scope = stateCache.get(state);
  if (!scope) return null;
  stateCache.del(state);
  return scope;
}
