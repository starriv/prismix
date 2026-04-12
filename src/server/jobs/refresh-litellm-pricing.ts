/**
 * Periodic job: refresh LiteLLM pricing catalog + detect price drift.
 *
 * Runs every 6 hours. On each refresh, compares stored model prices
 * against the LiteLLM catalog and logs warnings for significant drift.
 * Never auto-updates prices — admins own their pricing.
 */
import { and, eq } from "drizzle-orm";

import {
  isCatalogReady,
  lookupPricing,
  refreshLiteLLMPricing,
} from "@/server/ai/lib/litellm-pricing";
import { aiModels, aiProviders, db, queryAll } from "@/server/db";
import { log } from "@/server/lib/logger";
import { formatPercent } from "@/shared/number";

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DRIFT_THRESHOLD = 0.1; // 10% relative difference

let timer: ReturnType<typeof setInterval> | null = null;

// ── Drift detection ──────────────────────────────────────────────────

async function checkPriceDrift(): Promise<void> {
  if (!isCatalogReady()) return;

  try {
    const rows = await queryAll<{
      modelId: string;
      inputPrice: string;
      outputPrice: string;
      providerId: string;
      providerName: string;
    }>(
      db
        .select({
          modelId: aiModels.modelId,
          inputPrice: aiModels.inputPrice,
          outputPrice: aiModels.outputPrice,
          providerId: aiProviders.providerId,
          providerName: aiProviders.name,
        })
        .from(aiModels)
        .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
        .where(and(eq(aiModels.enabled, true), eq(aiProviders.enabled, true))),
    );

    let driftCount = 0;

    for (const row of rows) {
      const catalog = lookupPricing(row.modelId, row.providerId);
      if (!catalog) continue;

      const inputDrift = relativeDiff(Number(row.inputPrice), Number(catalog.inputPricePerMTok));
      const outputDrift = relativeDiff(Number(row.outputPrice), Number(catalog.outputPricePerMTok));

      if (inputDrift > DRIFT_THRESHOLD || outputDrift > DRIFT_THRESHOLD) {
        log.pricing.warn(
          {
            provider: row.providerId,
            model: row.modelId,
            stored: { input: row.inputPrice, output: row.outputPrice },
            litellm: { input: catalog.inputPricePerMTok, output: catalog.outputPricePerMTok },
            driftPct: { input: pct(inputDrift), output: pct(outputDrift) },
          },
          "Price drift detected",
        );
        driftCount++;
      }
    }

    if (driftCount > 0) {
      log.pricing.warn({ driftCount, totalModels: rows.length }, "Price drift summary");
    }
  } catch (err) {
    log.pricing.error({ err }, "Failed to check price drift");
  }
}

function relativeDiff(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 0;
  return Math.abs(a - b) / max;
}

function pct(v: number): string {
  return formatPercent(v);
}

// ── Job lifecycle ────────────────────────────────────────────────────

async function run(): Promise<void> {
  await refreshLiteLLMPricing();
  await checkPriceDrift();
}

/** Start the periodic pricing refresh job. Call once from bootstrap. */
export function initLiteLLMPricingJob(): void {
  // Fire-and-forget first run (don't block bootstrap)
  run().catch((err) => {
    log.pricing.error({ err }, "Initial LiteLLM pricing refresh failed");
  });
  timer = setInterval(() => {
    run().catch((err) => {
      log.pricing.error({ err }, "LiteLLM pricing refresh failed");
    });
  }, INTERVAL_MS);
  log.pricing.info({ intervalMs: INTERVAL_MS }, "LiteLLM pricing refresh job started");
}

/** Stop the periodic refresh job. Call on graceful shutdown. */
export function stopLiteLLMPricingJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
