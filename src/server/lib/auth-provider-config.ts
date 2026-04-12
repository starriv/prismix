/**
 * Auth provider configuration — DB-backed with in-memory cache.
 *
 * Controls which login methods (credentials, Google, GitHub) are enabled.
 * SIWE (wallet) is always enabled and not configurable here.
 *
 * Default config is seeded into global_settings via deploy/seed/*.sql
 * on first deploy. No hardcoded defaults in code.
 *
 * OAuth client secrets are AES-256-GCM encrypted before DB storage.
 * The in-memory cache holds decrypted values for runtime use.
 */
import type { AuthProviderType } from "@/server/auth/strategy";

import { settingsRepo } from "../repos";
import { decrypt, encrypt } from "./crypto";
import { log } from "./logger";

// ── Types ───────────────────────────────────────────────────────────

export interface ProviderConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  /** OIDC: issuer URL (e.g. https://company.okta.com) */
  issuer?: string;
  /** OIDC: additional scopes beyond "openid email profile" */
  scopes?: string[];
  /** Display name for login button (e.g. "Company SSO") */
  displayName?: string;
  /** SAML: IdP entity ID */
  entityId?: string;
  /** SAML: IdP SSO login URL */
  ssoUrl?: string;
  /** SAML: IdP SSO logout URL (optional) */
  sloUrl?: string;
  /** SAML: IdP X.509 signing certificate (PEM, no headers) */
  certificate?: string;
  /** SAML: IdP metadata URL (auto-fetches entityId, ssoUrl, certificate) */
  metadataUrl?: string;
}

export type AuthProvidersConfig = Record<string, ProviderConfig>;

// ── Constants ───────────────────────────────────────────────────────

const DB_KEY = "auth_providers";
const DOMAIN_TAG = "auth-provider-config"; // domain separator for PBKDF2 key derivation

// ── Encrypt / Decrypt secrets ───────────────────────────────────────

/** Fields that contain secrets and should be encrypted in DB */
const SECRET_FIELDS = ["clientSecret", "certificate"] as const;

function encryptSecrets(config: AuthProvidersConfig): AuthProvidersConfig {
  const result: AuthProvidersConfig = {};
  for (const [key, val] of Object.entries(config)) {
    const entry = { ...val } as Record<string, unknown>;
    for (const field of SECRET_FIELDS) {
      const v = val[field];
      if (v && v !== "****") {
        try {
          entry[field] = encrypt(v, DOMAIN_TAG);
        } catch {
          // If encryption fails, store as-is
        }
      }
    }
    result[key] = entry as unknown as ProviderConfig;
  }
  return result;
}

function decryptSecrets(config: AuthProvidersConfig): AuthProvidersConfig {
  const result: AuthProvidersConfig = {};
  for (const [key, val] of Object.entries(config)) {
    const entry = { ...val } as Record<string, unknown>;
    for (const field of SECRET_FIELDS) {
      const v = val[field];
      if (v && v.includes(":")) {
        try {
          entry[field] = decrypt(v, DOMAIN_TAG);
        } catch {
          log.auth.warn({ provider: key, field }, "Failed to decrypt secret, clearing");
          entry[field] = "";
        }
      }
    }
    result[key] = entry as unknown as ProviderConfig;
  }
  return result;
}

// ── Cache ───────────────────────────────────────────────────────────

let cached: AuthProvidersConfig | null = null;

export function getAuthProviderConfigCached(): AuthProvidersConfig {
  if (!cached) {
    log.auth.warn("Auth provider config not initialized — returning empty. Ensure seed SQL ran.");
  }
  return cached ?? {};
}

export async function initAuthProviderConfig(): Promise<void> {
  const raw = await settingsRepo.getGlobal(DB_KEY);
  if (raw) {
    try {
      cached = decryptSecrets(JSON.parse(raw) as AuthProvidersConfig);
    } catch {
      log.auth.error("Failed to parse auth_providers from DB");
      cached = {};
    }
  } else {
    log.auth.warn("No auth_providers in DB — login strategies disabled until configured via admin");
    cached = {};
  }
}

export async function saveAuthProviderConfig(config: AuthProvidersConfig): Promise<void> {
  const encrypted = encryptSecrets(config);
  await settingsRepo.setGlobal(DB_KEY, JSON.stringify(encrypted));
  cached = config;
}

export function invalidateAuthProviderConfig(): void {
  cached = null;
}

// ── Query helpers ───────────────────────────────────────────────────

/** Check if a provider is enabled. SIWE is always enabled. */
export function isProviderEnabled(name: AuthProviderType): boolean {
  if (name === "siwe") return true;
  const config = getAuthProviderConfigCached();
  return config[name]?.enabled ?? false;
}

/** Get OAuth credentials for a provider from DB config (decrypted). */
export function getProviderCredentials(name: string): { clientId: string; clientSecret: string } {
  const config = getAuthProviderConfigCached();
  const providerConfig = config[name];
  return {
    clientId: providerConfig?.clientId ?? "",
    clientSecret: providerConfig?.clientSecret ?? "",
  };
}

/** Get full provider config (all fields, not just credentials). */
export function getProviderFullConfig(name: string): ProviderConfig {
  const config = getAuthProviderConfigCached();
  return config[name] ?? { enabled: false };
}

/** List only enabled provider names. */
export function listEnabledProviders(): AuthProviderType[] {
  const all: AuthProviderType[] = ["siwe", "credentials", "google", "github", "oidc", "saml"];
  return all.filter(isProviderEnabled);
}
