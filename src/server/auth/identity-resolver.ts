import { log } from "@/server/lib/logger";
import { ensureUserAgent } from "@/server/lib/wallet";
import { adminRepo, identityRepo, userRepo } from "@/server/repos";

import type { AuthIdentity } from "./strategy";
import { AuthError } from "./strategy";

/**
 * Resolve an AuthIdentity to a user ID.
 *
 * Looks up the identities table first. If not found and `autoRegister` is true,
 * creates a new user + identity record. The UNIQUE constraint on
 * (provider, providerAccountId, userRole) prevents duplicate identities.
 */
export async function resolveIdentity(
  identity: AuthIdentity,
  role: "user" | "admin",
  options?: { autoRegister?: boolean; name?: string },
): Promise<{ userId: number; isNew: boolean }> {
  // 1. Look up existing identity
  const existing = await identityRepo.findByProviderAndAccount(
    identity.provider,
    identity.providerAccountId,
    role,
  );

  if (existing) {
    return { userId: existing.userId, isNew: false };
  }

  // 2. Not found — auto-register?
  if (!options?.autoRegister) {
    throw new AuthError("Account not found", "account_not_found", 403);
  }

  // 3. Create user
  let userId: number;

  if (role === "user") {
    const user = await userRepo.create({
      name: options.name ?? identity.profile?.name ?? identity.providerAccountId,
      email: identity.profile?.email ?? null,
      avatar: identity.profile?.avatar ?? null,
      address: identity.provider === "siwe" ? identity.providerAccountId : null,
    });
    userId = user.id;

    // Auto-create pay agent for new user
    try {
      await ensureUserAgent(user.id);
    } catch (err) {
      log.auth.warn({ err, userId: user.id }, "Failed to create agent on registration");
    }
  } else {
    const admin = await adminRepo.create({
      name: options.name ?? identity.profile?.name ?? identity.providerAccountId,
      email: identity.profile?.email ?? null,
      address: identity.provider === "siwe" ? identity.providerAccountId : null,
    });
    userId = admin.id;
  }

  // 4. Create identity record (UNIQUE constraint prevents duplicates)
  await identityRepo.create({
    userId,
    userRole: role,
    provider: identity.provider,
    providerAccountId: identity.providerAccountId.toLowerCase(),
    passwordHash: (identity._extra?.passwordHash as string) ?? null,
    profileData: identity.profile ? JSON.stringify(identity.profile) : null,
  });

  log.auth.info({ userId, role, provider: identity.provider }, "Auto-registered new user");
  return { userId, isNew: true };
}
