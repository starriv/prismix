/**
 * API Key auth strategy — authenticates admin API keys (skm_ prefix).
 *
 * Validates by SHA-256 hashing the raw key and looking up the hash
 * in the api_keys table. Updates last_used_at asynchronously.
 */
import { hashApiKey } from "../../lib/crypto";
import { enqueueJob } from "../../lib/write-queue";
import { apiKeyRepo } from "../../repos";
import type { AuthMiddlewareStrategy, AuthResult } from "./strategy";

export class ApiKeyAuthStrategy implements AuthMiddlewareStrategy {
  canHandle(token: string): boolean {
    return token.startsWith("skm_");
  }

  async authenticate(token: string): Promise<AuthResult | null> {
    const hash = hashApiKey(token);
    const row = await apiKeyRepo.findByHash(hash);
    if (!row || row.status !== "active") return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    // Async update last_used_at — don't block the request
    enqueueJob("api-key-touch", { apiKeyId: row.id });

    // API keys authenticate as admin — resolve adminId from settings or use a fixed system admin
    // In the single-operator model, API keys are admin management keys
    return {
      adminId: 1, // system admin — API keys are admin-level
      source: "api_key",
      keyId: row.id,
    };
  }
}
