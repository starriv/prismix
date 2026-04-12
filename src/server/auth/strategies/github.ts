import crypto from "crypto";

import { createCacheStore } from "@/server/cache";
import { getProviderCredentials } from "@/server/lib/auth-provider-config";

import type { AuthIdentity, AuthStrategy, InitializeResult } from "../strategy";
import { AuthError } from "../strategy";

// ── OAuth state cache (CSRF protection) ─────────────────────────────

const STATE_TTL = 5 * 60 * 1000; // 5min
const stateCache = createCacheStore<string>("github-oauth-state");

export class GithubAuthStrategy implements AuthStrategy {
  readonly name = "github" as const;

  private get credentials() {
    const creds = getProviderCredentials("github");
    if (!creds.clientId || !creds.clientSecret) {
      throw new AuthError("GitHub OAuth not configured", "provider_error", 500);
    }
    return creds;
  }

  private get callbackUrl(): string {
    const origin =
      process.env.CORS_ORIGIN || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : undefined);
    if (!origin)
      throw new AuthError("CORS_ORIGIN or DOMAIN env var is required", "provider_error", 500);
    return `${origin}/api/auth/callback/github`;
  }

  async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const scope = (params.scope as string) || "user";
    const state = crypto.randomBytes(16).toString("hex");
    stateCache.set(state, scope, STATE_TTL);

    const searchParams = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: this.callbackUrl,
      scope: "user:email read:user",
      state,
    });

    const url = `https://github.com/login/oauth/authorize?${searchParams.toString()}`;
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

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        code,
        redirect_uri: this.callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      throw new AuthError("GitHub token exchange failed", "provider_error");
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new AuthError(
        `GitHub OAuth error: ${tokenData.error ?? "no access token"}`,
        "provider_error",
      );
    }

    // Fetch user info
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!userResponse.ok) {
      throw new AuthError("Failed to fetch GitHub user info", "provider_error");
    }

    const user = (await userResponse.json()) as {
      id: number;
      login: string;
      name?: string;
      email?: string;
      avatar_url?: string;
    };

    // If email is null, fetch from /user/emails
    let email = user.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? emails[0]?.email;
      }
    }

    return {
      provider: "github",
      providerAccountId: String(user.id),
      profile: {
        email: email ?? undefined,
        name: user.name ?? user.login,
        avatar: user.avatar_url,
      },
    };
  }
}
