/**
 * Periodic job: delete AI usage logs older than the retention window.
 *
 * Runs as a BullMQ repeatable job (every 1h) so multi-instance deployments
 * share one schedule. Deletes rows from `ai_usage_logs` where `created_at`
 * is older than `AI_USAGE_LOG_RETENTION_DAYS` (default 7 days).
 *
 * Request/response bodies are NOT affected — those are stored in Redis with
 * their own TTL (see `AI_REQUEST_LOG_TTL_DAYS` in log-store).
 */
import { Queue, Worker } from "bullmq";

import { removeStaleRepeatableJobs } from "@/server/jobs/repeatable";
import { log } from "@/server/lib/logger";
import { aiUsageLogRepo } from "@/server/repos";

const QUEUE_NAME = "ai-usage-log-cleanup";
const JOB_NAME = "cleanup-all";
const REPEAT_JOB_ID = "ai-usage-log-cleanup-recurring";
const IMMEDIATE_JOB_ID = "ai-usage-log-cleanup-immediate";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const RETENTION_DAYS = Number(process.env.AI_USAGE_LOG_RETENTION_DAYS) || 7;

let queue: Queue | null = null;
let worker: Worker | null = null;

export async function cleanupAiUsageLogs(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await aiUsageLogRepo.deleteOlderThan(cutoff);
  if (deleted > 0) {
    log.gateway.info({ deleted, retentionDays: RETENTION_DAYS }, "Cleaned up old AI usage logs");
  }
}

export async function initAiUsageLogCleanupJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.gateway.warn("REDIS_URL not set — AI usage log cleanup job disabled");
    return;
  }

  const connection = { url: redisUrl };

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });

  await removeStaleRepeatableJobs(queue, {
    jobName: JOB_NAME,
    repeatJobId: REPEAT_JOB_ID,
    everyMs: CHECK_INTERVAL_MS,
    log: log.gateway,
    label: "AI usage log cleanup",
  });

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: REPEAT_JOB_ID,
    },
  );

  await queue.add(JOB_NAME, {}, { jobId: IMMEDIATE_JOB_ID, removeOnComplete: true });

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await cleanupAiUsageLogs();
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, err) => {
    log.gateway.error({ err }, "AI usage log cleanup job failed");
  });

  worker.on("error", (err) => {
    log.gateway.error({ err }, "AI usage log cleanup worker error");
  });

  log.gateway.info(
    { intervalMs: CHECK_INTERVAL_MS, retentionDays: RETENTION_DAYS },
    "AI usage log cleanup job started",
  );
}

export async function closeAiUsageLogCleanupJob(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
