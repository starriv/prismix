import { AppError } from "@/server/lib/errors";

/** Auth provider types */
export type AuthProviderType = "siwe" | "credentials" | "google" | "github" | "oidc" | "saml";

/** Unified identity output — all strategies return this after authentication */
export interface AuthIdentity {
  provider: AuthProviderType;
  providerAccountId: string;
  profile?: {
    email?: string;
    name?: string;
    avatar?: string;
  };
  /** Strategy-private data (e.g. passwordHash for credentials), used by identity resolver */
  _extra?: Record<string, unknown>;
}

/** Initialize result — data returned to the client during the init step */
export interface InitializeResult {
  data: Record<string, unknown>;
}

/** Auth error with typed error codes */
export class AuthError extends AppError {
  constructor(
    message: string,
    public readonly code:
      | "invalid_credentials"
      | "account_not_found"
      | "account_exists"
      | "password_too_weak"
      | "provider_error"
      | "nonce_expired"
      | "signature_invalid"
      | "rate_limited",
    status: number = 401,
  ) {
    super(message, status, code);
    this.name = "AuthError";
  }
}

/** Auth strategy interface — all strategies implement this */
export interface AuthStrategy {
  readonly name: AuthProviderType;
  initialize?(params: Record<string, unknown>): Promise<InitializeResult>;
  authenticate(params: Record<string, unknown>): Promise<AuthIdentity>;
  register?(params: Record<string, unknown>): Promise<AuthIdentity>;
}
