/**
 * Queue barrel — Redis-backed job queue via BullMQ.
 *
 * Redis (REDIS_URL) is mandatory. Creates a RedisJobQueue for persistent,
 * multi-instance job processing.
 *
 * Consumers import from this barrel only:
 *   import { createJobQueue, type JobQueue } from "@/server/queue";
 */
import type { JobQueue } from "./job-queue";

// ── Public API ──────────────────────────────────────────────────────

export type { JobData, JobEnqueueOptions, JobHandler, JobQueue, JobQueueStats } from "./job-queue";

/**
 * Factory: creates a RedisJobQueue.
 *
 * @param name — queue label (e.g. "write-queue", "log-queue")
 * @param maxDepth — function returning max depth (supports dynamic config)
 */
export async function createJobQueue(name: string, maxDepth: () => number): Promise<JobQueue> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required — Redis is mandatory for job queues");
  const { RedisJobQueue } = await import("./redis-job-queue");
  return new RedisJobQueue(name, maxDepth, { url: redisUrl });
}
