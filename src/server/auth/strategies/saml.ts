import crypto from "crypto";

import { SAML, ValidateInResponseTo } from "@node-saml/node-saml";
import type { CacheProvider } from "@node-saml/node-saml/lib/types";

import { getProviderFullConfig } from "@/server/lib/auth-provider-config";
import {
  consumeEphemeralState,
  getEphemeralState,
  setEphemeralState,
} from "@/server/lib/ephemeral-state";
import { log } from "@/server/lib/logger";

import type { AuthIdentity, AuthStrategy, InitializeResult } from "../strategy";
import { AuthError } from "../strategy";

// ── State cache (RelayState for CSRF) ──────────────────────────────

const STATE_TTL = 5 * 60 * 1000; // 5min
const STATE_NAMESPACE = "saml-state";

// ── InResponseTo cache (replay protection) ──────────────────────────

const IN_RESPONSE_TO_NAMESPACE = "saml-in-response-to";

/** node-saml CacheProvider for InResponseTo validation */
const samlRequestCache: CacheProvider = {
  async saveAsync(key: string, value: string) {
    await setEphemeralState(IN_RESPONSE_TO_NAMESPACE, key, value, STATE_TTL);
    return { value, createdAt: Date.now() };
  },
  async getAsync(key: string) {
    return (await getEphemeralState<string>(IN_RESPONSE_TO_NAMESPACE, key)) ?? null;
  },
  async removeAsync(key: string | null) {
    if (!key) return null;
    return (await consumeEphemeralState<string>(IN_RESPONSE_TO_NAMESPACE, key)) ?? null;
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function getOrigin(): string {
  const origin =
    process.env.CORS_ORIGIN || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : undefined);
  if (!origin)
    throw new AuthError("CORS_ORIGIN or DOMAIN env var is required", "provider_error", 500);
  return origin;
}

function getSpEntityId(): string {
  return `${getOrigin()}/api/auth/saml/metadata`;
}

function getAcsUrl(): string {
  return `${getOrigin()}/api/auth/callback/saml`;
}

/**
 * Strip PEM headers/footers and whitespace to get raw base64 cert.
 * node-saml expects the cert without -----BEGIN/END CERTIFICATE----- lines.
 */
function stripPemHeaders(cert: string): string {
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function buildSamlInstance(cfg: ReturnType<typeof getProviderFullConfig>): SAML {
  if (!cfg.ssoUrl || !cfg.certificate) {
    throw new AuthError(
      "SAML IdP not configured (missing SSO URL or certificate)",
      "provider_error",
      500,
    );
  }

  return new SAML({
    entryPoint: cfg.ssoUrl,
    issuer: getSpEntityId(),
    idpCert: stripPemHeaders(cfg.certificate),
    callbackUrl: getAcsUrl(),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false, // some IdPs only sign the assertion
    signatureAlgorithm: "sha256",
    identifierFormat: null, // accept any NameID format
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: STATE_TTL,
    cacheProvider: samlRequestCache,
  });
}

// ── Strategy ────────────────────────────────────────────────────────

export class SamlStrategy implements AuthStrategy {
  readonly name = "saml" as const;

  private get config() {
    const full = getProviderFullConfig("saml");
    if (!full.ssoUrl || !full.certificate) {
      throw new AuthError("SAML IdP not configured", "provider_error", 500);
    }
    return full;
  }

  async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const cfg = this.config;
    const saml = buildSamlInstance(cfg);
    const scope = (params.scope as string) || "user";

    // RelayState carries the scope and acts as CSRF token
    const relayState = crypto.randomBytes(16).toString("hex");
    await setEphemeralState(STATE_NAMESPACE, relayState, scope, STATE_TTL);

    const loginUrl = await saml.getAuthorizeUrlAsync(relayState, getOrigin(), {});
    return { data: { url: loginUrl } };
  }

  async authenticate(params: Record<string, unknown>): Promise<AuthIdentity> {
    const samlResponse = params.SAMLResponse as string;
    const relayState = params.RelayState as string;

    if (!samlResponse) {
      throw new AuthError("SAML response is required", "invalid_credentials", 400);
    }

    // Validate RelayState (CSRF) — mandatory to prevent CSRF attacks
    if (!relayState) {
      throw new AuthError("SAML RelayState is required (CSRF protection)", "nonce_expired", 400);
    }
    const storedScope = await consumeEphemeralState<string>(STATE_NAMESPACE, relayState);
    if (!storedScope) {
      throw new AuthError("Invalid or expired SAML state", "nonce_expired");
    }

    const cfg = this.config;
    const saml = buildSamlInstance(cfg);

    let profile: Record<string, unknown>;
    try {
      const result = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      profile = result.profile as Record<string, unknown>;
    } catch (err) {
      log.auth.error({ err }, "SAML response validation failed");
      throw new AuthError("SAML assertion verification failed", "signature_invalid");
    }

    if (!profile || !profile.nameID) {
      throw new AuthError("SAML assertion missing nameID", "provider_error");
    }

    const nameID = profile.nameID as string;
    const nameIDFormat = (profile.nameIDFormat as string) ?? "";
    const email =
      (profile.email as string) ??
      (profile.mail as string) ??
      (nameIDFormat.includes("emailAddress") ? nameID : undefined);

    // Attempt to build a display name from common SAML attributes
    const firstName = profile.firstName ?? profile.givenName ?? profile["urn:oid:2.5.4.42"];
    const lastName = profile.lastName ?? profile.sn ?? profile["urn:oid:2.5.4.4"];
    const joinedName = [firstName, lastName].filter(Boolean).join(" ");
    const displayName = (profile.displayName as string) ?? (joinedName || nameID);

    return {
      provider: "saml",
      providerAccountId: nameID,
      profile: {
        email,
        name: displayName as string,
        avatar: undefined,
      },
    };
  }

  /** Generate SP metadata XML for IdP configuration */
  generateMetadata(): string {
    const cfg = getProviderFullConfig("saml");
    const saml = buildSamlInstance(cfg);
    return saml.generateServiceProviderMetadata(null, null);
  }
}

/** Consume a SAML RelayState token and return the stored scope */
export async function consumeSamlState(state: string): Promise<string | null> {
  return (await consumeEphemeralState<string>(STATE_NAMESPACE, state)) ?? null;
}
