/**
 * Seed default AI providers (system-level).
 *
 * Reads the provider catalog from `global_settings.ai_provider_catalog` (seeded
 * via deploy/seed/pg.sql). Only providers are seeded — models must be configured
 * via the discover-models UI or manual creation.
 *
 * If the DB catalog is empty, no providers are seeded and a warning is logged.
 */
import { log } from "@/server/lib/logger";
import { aiProviderRepo } from "@/server/repos/ai-provider-repo";
import { settingsRepo } from "@/server/repos/settings-repo";

// ── Types ────────────────────────────────────────────────────────────

interface ProviderCatalogEntry {
  providerId: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  authConfig?: Record<string, unknown>;
}

const DB_KEY = "ai_provider_catalog";

// ── Seed function ─────────────────────────────────────────────────────

export async function seedDefaultProviders(): Promise<void> {
  const raw = await settingsRepo.getGlobal(DB_KEY);
  if (!raw) {
    log.pricing.warn("ai_provider_catalog not found in global_settings — skipping provider seed");
    return;
  }

  let catalog: ProviderCatalogEntry[];
  try {
    catalog = JSON.parse(raw) as ProviderCatalogEntry[];
  } catch {
    log.pricing.error("Failed to parse ai_provider_catalog JSON");
    return;
  }

  let created = 0;

  for (const entry of catalog) {
    const existing = await aiProviderRepo.findByProviderId(entry.providerId);
    if (existing) continue;

    await aiProviderRepo.create({
      providerId: entry.providerId,
      name: entry.name,
      baseUrl: entry.baseUrl,
      apiFormat: entry.apiFormat,
      authType: entry.authType,
      authConfig: entry.authConfig ? JSON.stringify(entry.authConfig) : "{}",
      iconUrl: null,
      enabled: true,
    });
    created++;
  }

  if (created > 0) {
    log.pricing.info({ providers: created }, "Seeded default AI providers");
  }
}
