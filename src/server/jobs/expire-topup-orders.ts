/**
 * Periodic job: expire stale top-up orders.
 *
 * Runs as a BullMQ repeatable job (every 10 min) so multi-instance deployments
 * share one schedule. Marks pending orders older than 24h as expired and emits
 * domain events for each expired order.
 */
import { Queue, Worker } from "bullmq";

import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { removeStaleRepeatableJobs } from "@/server/jobs/repeatable";
import { log } from "@/server/lib/logger";
import { payAgentRepo, topupOrderRepo } from "@/server/repos";

import { TOPUP_SCAN_TTL_MS } from "./scan-topup-deposit";

const QUEUE_NAME = "topup-expiry";
const JOB_NAME = "expire-all";
const REPEAT_JOB_ID = "topup-expiry-recurring";
const IMMEDIATE_JOB_ID = "topup-expiry-immediate";
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const TTL_MS = TOPUP_SCAN_TTL_MS;

let queue: Queue | null = null;
let worker: Worker | null = null;

export async function expireTopupOrders(): Promise<void> {
  const cutoff = Date.now() - TTL_MS;
  const expired = await topupOrderRepo.expirePending(cutoff);
  if (expired.length === 0) return;

  log.gateway.info({ count: expired.length }, "Expired stale top-up orders");

  for (const order of expired) {
    const agent = await payAgentRepo.findById(order.agentId);
    emit(DOMAIN_EVENT_TYPES.TOPUP_EXPIRED, `agent:${order.agentId}`, {
      orderId: order.id,
      agentId: order.agentId,
      agentName: agent?.name,
      amount: order.amount,
    });
  }
}

export async function initTopupExpiryJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.gateway.warn("REDIS_URL not set — top-up expiry job disabled");
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
    label: "top-up expiry",
  });

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: REPEAT_JOB_ID,
    },
  );

  // One-time immediate run to clean up stale orders from previous shutdown.
  // Stable jobId dedupes concurrent boots so a multi-replica deploy fires it once;
  // removeOnComplete lets it run again on the next deploy.
  await queue.add(JOB_NAME, {}, { jobId: IMMEDIATE_JOB_ID, removeOnComplete: true });

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await expireTopupOrders();
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, err) => {
    log.gateway.error({ err }, "Top-up expiry job failed");
  });

  worker.on("error", (err) => {
    log.gateway.error({ err }, "Top-up expiry worker error");
  });

  log.gateway.info({ intervalMs: CHECK_INTERVAL_MS, ttlMs: TTL_MS }, "Top-up expiry job started");
}

export async function closeTopupExpiryJob(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
