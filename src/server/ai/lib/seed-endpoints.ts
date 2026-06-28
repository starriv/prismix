/**
 * Seed default AI endpoints (system-level).
 *
 * Reads the endpoint catalog from `global_settings.ai_endpoint_catalog` (seeded
 * via deploy/seed/pg.sql). Models must still be configured via discovery or
 * manual creation.
 */
import { log } from "@/server/lib/logger";
import { aiEndpointRepo, aiSupplierRepo } from "@/server/repos";
import { settingsRepo } from "@/server/repos/settings-repo";

// ── Types ────────────────────────────────────────────────────────────

interface EndpointCatalogEntry {
  supplierId: string;
  supplierName: string;
  endpointId: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  authConfig?: Record<string, unknown>;
  iconUrl?: string | null;
}

const DB_KEY = "ai_endpoint_catalog";

// ── Seed function ─────────────────────────────────────────────────────

export async function seedDefaultEndpoints(): Promise<void> {
  const raw = await settingsRepo.getGlobal(DB_KEY);
  if (!raw) {
    log.pricing.warn("ai_endpoint_catalog not found in global_settings — skipping endpoint seed");
    return;
  }

  let catalog: EndpointCatalogEntry[];
  try {
    catalog = JSON.parse(raw) as EndpointCatalogEntry[];
  } catch {
    log.pricing.error("Failed to parse ai_endpoint_catalog JSON");
    return;
  }

  let suppliersCreated = 0;
  let endpointsCreated = 0;

  for (const entry of catalog) {
    let supplier = await aiSupplierRepo.findBySupplierId(entry.supplierId);
    if (!supplier) {
      supplier = await aiSupplierRepo.create({
        supplierId: entry.supplierId,
        name: entry.supplierName,
        iconUrl: entry.iconUrl ?? null,
        enabled: true,
      });
      suppliersCreated++;
    }

    const existing = await aiEndpointRepo.findByEndpointId(entry.endpointId);
    if (existing) continue;

    await aiEndpointRepo.create({
      supplierId: supplier.id,
      endpointId: entry.endpointId,
      name: entry.name,
      baseUrl: entry.baseUrl,
      apiFormat: entry.apiFormat,
      authType: entry.authType,
      authConfig: entry.authConfig ? JSON.stringify(entry.authConfig) : "{}",
      iconUrl: null,
      enabled: true,
    });
    endpointsCreated++;
  }

  if (suppliersCreated > 0 || endpointsCreated > 0) {
    log.pricing.info(
      { suppliers: suppliersCreated, endpoints: endpointsCreated },
      "Seeded default AI endpoints",
    );
  }
}
