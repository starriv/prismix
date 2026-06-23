/**
 * Periodic job: expire limited-free model tags.
 *
 * Runs as a BullMQ repeatable job so multi-instance deployments share one
 * schedule. Clears the tag AND disables the model on expiry — the
 * user-facing API still derives active state from the timestamp, so delayed
 * cleanup cannot show an expired tag.
 */
import { Queue, type RepeatableJob, Worker } from "bullmq";

import { log } from "@/server/lib/logger";
import { aiModelRepo } from "@/server/repos";

const QUEUE_NAME = "limited-free-model-expiry";
const JOB_NAME = "expire-all";
const REPEAT_JOB_ID = "limited-free-model-expiry";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let queue: Queue | null = null;
let worker: Worker | null = null;

export async function expireLimitedFreeModels(now = new Date()): Promise<number> {
  const expired = await aiModelRepo.disableExpiredLimitedFreeModels(now);
  if (expired > 0) {
    log.gateway.info({ count: expired }, "Expired limited-free models disabled");
  }
  return expired;
}

async function removeStaleRepeatableJobs(targetQueue: Queue): Promise<void> {
  const repeatableJobs: RepeatableJob[] = await targetQueue.getRepeatableJobs();
  const expectedEvery = String(CHECK_INTERVAL_MS);
  for (const job of repeatableJobs) {
    if (job.name !== JOB_NAME) continue;
    if (job.id !== REPEAT_JOB_ID) continue;
    if (job.every === expectedEvery) continue;

    await targetQueue.removeRepeatableByKey(job.key);
    log.gateway.info(
      { repeatKey: job.key, previousEvery: job.every, nextEvery: expectedEvery },
      "Removed stale limited-free model expiry repeatable job",
    );
  }
}

export async function initLimitedFreeModelExpiryJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.gateway.warn("REDIS_URL not set — limited-free model expiry job disabled");
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

  await removeStaleRepeatableJobs(queue);

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: REPEAT_JOB_ID,
    },
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await expireLimitedFreeModels();
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, err) => {
    log.gateway.error({ err }, "Limited-free model expiry job failed");
  });

  worker.on("error", (err) => {
    log.gateway.error({ err }, "Limited-free model expiry worker error");
  });

  log.gateway.info({ intervalMs: CHECK_INTERVAL_MS }, "Limited-free model expiry job started");
}

export async function closeLimitedFreeModelExpiryJob(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
