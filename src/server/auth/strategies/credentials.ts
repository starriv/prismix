import argon2 from "argon2";

import { identityRepo } from "@/server/repos";

import type { AuthIdentity, AuthStrategy } from "../strategy";
import { AuthError } from "../strategy";

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

/**
 * Pre-computed dummy hash for timing-safe user enumeration defence.
 * When an account is not found, we verify against this dummy so the
 * response time is indistinguishable from a real password check.
 */
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+daw";

export class CredentialsStrategy implements AuthStrategy {
  readonly name = "credentials" as const;

  async authenticate(params: Record<string, unknown>): Promise<AuthIdentity> {
    const email = (params.email as string)?.toLowerCase()?.trim();
    const password = params.password as string;
    const scope = (params.scope as string) || "user";

    if (!email || !password) {
      throw new AuthError("Email and password are required", "invalid_credentials", 400);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthError("Invalid credentials", "invalid_credentials", 400);
    }

    const identity = await identityRepo.findByProviderAndAccount("credentials", email, scope);

    if (!identity) {
      // Timing-safe defence: always run argon2.verify so response time is
      // indistinguishable from a real password check (prevents user enumeration).
      await argon2.verify(DUMMY_HASH, password).catch(() => {});

      // User scope: no implicit signup — must register explicitly
      if (scope === "user") {
        throw new AuthError("Invalid credentials", "invalid_credentials");
      }
      // Admin scope: validate password strength, return identity with hash
      // so resolveIdentity can decide whether to auto-register (first admin) or reject
      if (password.length < MIN_PASSWORD_LENGTH || !PASSWORD_COMPLEXITY_RE.test(password)) {
        throw new AuthError("Invalid credentials", "invalid_credentials", 400);
      }
      const passwordHash = await argon2.hash(password);
      return {
        provider: "credentials",
        providerAccountId: email,
        profile: { email, name: email.split("@")[0] },
        _extra: { passwordHash },
      };
    }

    if (!identity.passwordHash) {
      // Timing-safe: still run argon2.verify against dummy
      await argon2.verify(DUMMY_HASH, password).catch(() => {});
      throw new AuthError("Invalid credentials", "invalid_credentials");
    }

    const valid = await argon2.verify(identity.passwordHash, password);
    if (!valid) {
      throw new AuthError("Invalid credentials", "invalid_credentials");
    }

    return {
      provider: "credentials",
      providerAccountId: email,
      profile: { email, name: email.split("@")[0] },
    };
  }

  async register(params: Record<string, unknown>): Promise<AuthIdentity> {
    const email = (params.email as string)?.toLowerCase()?.trim();
    const password = params.password as string;
    const name = params.name as string | undefined;
    const scope = (params.scope as string) || "user";

    if (!email || !password) {
      throw new AuthError("Email and password are required", "invalid_credentials", 400);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthError(
        `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
        "password_too_weak",
        400,
      );
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        "password_too_weak",
        400,
      );
    }
    if (!PASSWORD_COMPLEXITY_RE.test(password)) {
      throw new AuthError(
        "Password must contain at least one uppercase letter, one lowercase letter, and one digit",
        "password_too_weak",
        400,
      );
    }

    // Check if already exists
    const existing = await identityRepo.findByProviderAndAccount("credentials", email, scope);
    if (existing) {
      throw new AuthError("Account already exists", "account_exists", 409);
    }

    const passwordHash = await argon2.hash(password);

    return {
      provider: "credentials",
      providerAccountId: email,
      profile: { email, name: name?.trim() },
      _extra: { passwordHash },
    };
  }
}
