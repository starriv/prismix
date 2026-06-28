/**
 * Periodic job: refresh LiteLLM pricing catalog + detect price drift.
 *
 * Runs as a BullMQ repeatable job (every 6 hours) so multi-instance deployments
 * share one schedule. On each refresh, compares stored model prices against
 * the LiteLLM catalog and logs warnings for significant drift.
 * Never auto-updates prices — admins own their pricing.
 */
import { Queue, Worker } from "bullmq";
import { and, eq } from "drizzle-orm";

import {
  isCatalogReady,
  lookupPricing,
  refreshLiteLLMPricing,
} from "@/server/ai/lib/litellm-pricing";
import { aiEndpoints, aiModelRoutes, aiModels, db, queryAll } from "@/server/db";
import { removeStaleRepeatableJobs } from "@/server/jobs/repeatable";
import { log } from "@/server/lib/logger";
import { formatPercent } from "@/shared/number";

const QUEUE_NAME = "litellm-pricing-refresh";
const JOB_NAME = "refresh";
const REPEAT_JOB_ID = "litellm-pricing-refresh-recurring";
const IMMEDIATE_JOB_ID = "litellm-pricing-refresh-immediate";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DRIFT_THRESHOLD = 0.1; // 10% relative difference

let queue: Queue | null = null;
let worker: Worker | null = null;

// ── Drift detection ──────────────────────────────────────────────────

async function checkPriceDrift(): Promise<void> {
  if (!isCatalogReady()) return;

  try {
    const rows = await queryAll<{
      modelId: string;
      inputPrice: string;
      outputPrice: string;
      endpointId: string;
      endpointName: string;
    }>(
      db
        .select({
          modelId: aiModels.modelId,
          inputPrice: aiModels.inputPrice,
          outputPrice: aiModels.outputPrice,
          endpointId: aiEndpoints.endpointId,
          endpointName: aiEndpoints.name,
        })
        .from(aiModels)
        .innerJoin(aiModelRoutes, eq(aiModels.id, aiModelRoutes.modelId))
        .innerJoin(aiEndpoints, eq(aiModelRoutes.endpointId, aiEndpoints.id))
        .where(
          and(
            eq(aiModels.enabled, true),
            eq(aiModelRoutes.enabled, true),
            eq(aiEndpoints.enabled, true),
            eq(aiEndpoints.autoDisabled, false),
          ),
        ),
    );

    let driftCount = 0;

    for (const row of rows) {
      const catalog = lookupPricing(row.modelId, row.endpointId);
      if (!catalog) continue;

      const inputDrift = relativeDiff(Number(row.inputPrice), Number(catalog.inputPricePerMTok));
      const outputDrift = relativeDiff(Number(row.outputPrice), Number(catalog.outputPricePerMTok));

      if (inputDrift > DRIFT_THRESHOLD || outputDrift > DRIFT_THRESHOLD) {
        log.pricing.warn(
          {
            endpoint: row.endpointId,
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

export async function refreshPricingAndCheckDrift(): Promise<void> {
  await refreshLiteLLMPricing();
  await checkPriceDrift();
}

export async function initLiteLLMPricingJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.pricing.warn("REDIS_URL not set — LiteLLM pricing refresh job disabled");
    return;
  }

  const connection = { url: redisUrl };

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });

  await removeStaleRepeatableJobs(queue, {
    jobName: JOB_NAME,
    repeatJobId: REPEAT_JOB_ID,
    everyMs: CHECK_INTERVAL_MS,
    log: log.pricing,
    label: "LiteLLM pricing",
  });

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: REPEAT_JOB_ID,
    },
  );

  // One-time immediate run (worker processes async — doesn't block bootstrap).
  // Stable jobId dedupes concurrent boots so a multi-replica deploy fires it once;
  // removeOnComplete lets it run again on the next deploy.
  await queue.add(JOB_NAME, {}, { jobId: IMMEDIATE_JOB_ID, removeOnComplete: true });

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await refreshPricingAndCheckDrift();
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, err) => {
    log.pricing.error({ err }, "LiteLLM pricing refresh job failed");
  });

  worker.on("error", (err) => {
    log.pricing.error({ err }, "LiteLLM pricing refresh worker error");
  });

  log.pricing.info({ intervalMs: CHECK_INTERVAL_MS }, "LiteLLM pricing refresh job started");
}

export async function closeLiteLLMPricingJob(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
