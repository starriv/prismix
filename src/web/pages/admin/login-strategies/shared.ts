export interface ProviderState {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  issuer?: string;
  scopes?: string[];
  displayName?: string;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  metadataUrl?: string;
}

export type ConfigState = Record<string, ProviderState>;

export const GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
export const GOOGLE_SECRET_PREFIX = "GOCSPX-";
export const GITHUB_ID_RE = /^(Iv1\.|Iv23\.|Ov23|[a-f0-9]{20}$)/;
export const GITHUB_SECRET_RE = /^[a-f0-9]{40}$/;

export function validateField(
  provider: string,
  field: "clientId" | "clientSecret",
  value: string,
): string | null {
  if (!value.trim()) return null;
  if (provider === "google") {
    if (field === "clientId" && !value.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) return "google-id";
    if (field === "clientSecret" && !value.startsWith(GOOGLE_SECRET_PREFIX) && value !== "****")
      return "google-secret";
  }
  if (provider === "github") {
    if (field === "clientId" && !GITHUB_ID_RE.test(value) && value.length < 10) return "github-id";
    if (
      field === "clientSecret" &&
      !GITHUB_SECRET_RE.test(value) &&
      value !== "****" &&
      value.length < 30
    )
      return "github-secret";
  }
  return null;
}

export function validateOAuthCredentials(config: ConfigState): string[] {
  const errors: string[] = [];
  for (const name of ["google", "github"] as const) {
    const p = config[name];
    if (!p.enabled) continue;
    if (!p.clientId.trim() || !p.clientSecret.trim()) {
      errors.push(`missing-${name}`);
    } else {
      const idErr = validateField(name, "clientId", p.clientId);
      if (idErr) errors.push(idErr);
      const secretErr = validateField(name, "clientSecret", p.clientSecret);
      if (secretErr) errors.push(secretErr);
    }
  }
  const oidc = config.oidc;
  if (oidc?.enabled) {
    if (!oidc.issuer?.trim() || !oidc.clientId.trim() || !oidc.clientSecret.trim()) {
      errors.push("missing-oidc");
    } else if (!oidc.issuer.startsWith("https://")) {
      errors.push("oidc-issuer");
    }
  }
  const saml = config.saml;
  if (saml?.enabled) {
    if (!saml.entityId?.trim() || !saml.ssoUrl?.trim() || !saml.certificate?.trim()) {
      errors.push("missing-saml");
    } else if (!saml.ssoUrl.startsWith("https://")) {
      errors.push("saml-sso-url");
    }
  }
  return errors;
}
