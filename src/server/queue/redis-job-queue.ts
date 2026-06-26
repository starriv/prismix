/**
 * RedisJobQueue — distributed job queue via BullMQ (Redis-backed).
 *
 * Used in production when REDIS_URL is set. Provides:
 *   - Persistence — jobs survive process restarts
 *   - Multi-instance — workers on any instance can process jobs
 *   - Retry — failed jobs are retried with exponential backoff
 *   - Backpressure — max queue depth enforcement via sampled Redis depth
 *
 * Adding another backend (RocketMQ, Kafka, SQS):
 *   Implement the JobQueue interface, select in the factory.
 */
import { Queue, Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";

import { log } from "@/server/lib/logger";

import type { JobData, JobEnqueueOptions, JobHandler, JobQueue, JobQueueStats } from "./job-queue";

export interface RedisJobQueueOptions {
  startWorker?: boolean;
  concurrency?: number;
}

// Depth sampling interval. The sampled value is used for backpressure checks
// in enqueue(), so the hot path stays O(1) — no Redis round-trip per enqueue.
const DEPTH_SAMPLE_INTERVAL_MS = 1000;

export class RedisJobQueue implements JobQueue {
  private queue: Queue;
  private worker: Worker | null = null;
  private handlers = new Map<string, JobHandler>();
  private readonly label: string;
  private readonly maxDepth: () => number;
  private droppedCount = 0;
  private totalEnqueuedCount = 0;
  private totalProcessedCount = 0;
  private totalFailedCount = 0;

  // Sampled Redis depth (waiting + active + delayed). Updated every 1s by the
  // depth sampler. This is the only accurate depth signal in a multi-instance
  // topology — per-process enqueue/process counters diverge (producer-only:
  // counter grows unboundedly; worker: counter goes negative because it
  // processes jobs enqueued by other instances).
  private redisDepth = 0;
  private depthSampler: ReturnType<typeof setInterval> | null = null;

  constructor(
    label: string,
    maxDepth: () => number,
    connection: ConnectionOptions,
    options?: RedisJobQueueOptions,
  ) {
    this.label = label;
    this.maxDepth = maxDepth;

    this.queue = new Queue(label, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true, // remove immediately — job payloads can be large (full request/response bodies)
        removeOnFail: { count: 100 }, // keep a small tail for debugging only
      },
    });

    if (options?.startWorker !== false) {
      this.worker = new Worker(
        label,
        async (job) => {
          const handler = this.handlers.get(job.name);
          if (!handler) {
            throw new Error(`No handler registered for job "${job.name}"`);
          }
          await handler(job.data as JobData);
          this.totalProcessedCount++;
        },
        {
          connection,
          concurrency: options?.concurrency ?? 5,
        },
      );

      this.worker.on("failed", (job, err) => {
        this.totalFailedCount++;
        log.queue.error(
          { queue: label, job: job?.name, attempt: job?.attemptsMade, error: err.message },
          "Job failed",
        );
      });

      this.worker.on("error", (err) => {
        log.queue.error({ err, queue: label }, "Worker error");
      });
    }

    this.depthSampler = setInterval(async () => {
      try {
        const counts = await this.queue.getJobCounts();
        this.redisDepth = counts.waiting + counts.active + counts.delayed;
      } catch (err) {
        log.queue.warn({ err, queue: label }, "Failed to sample Redis depth — using last value");
      }
    }, DEPTH_SAMPLE_INTERVAL_MS);
    this.depthSampler.unref?.();

    log.queue.info(
      {
        queue: label,
        worker: options?.startWorker !== false,
        concurrency: options?.concurrency ?? 5,
      },
      "Redis job queue initialized (BullMQ)",
    );
  }

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  enqueue(name: string, data: JobData, options?: JobEnqueueOptions): boolean {
    const currentMax = this.maxDepth();
    if (this.redisDepth > currentMax) {
      this.droppedCount++;
      log.queue.warn(
        { queue: this.label, job: name, maxDepth: currentMax, redisDepth: this.redisDepth },
        "Queue full, dropping job",
      );
      return false;
    }

    this.totalEnqueuedCount++;
    const queueOptions = options?.delayMs === undefined ? undefined : { delay: options.delayMs };
    const enqueuePromise = queueOptions
      ? this.queue.add(name, data, queueOptions)
      : this.queue.add(name, data);
    enqueuePromise.catch((err) => {
      this.totalEnqueuedCount--;
      this.totalFailedCount++;
      log.queue.error({ err, queue: this.label, job: name }, "Failed to enqueue job");
    });
    return true;
  }

  depth(): number {
    return this.redisDepth;
  }

  stats(): JobQueueStats {
    return {
      depth: this.redisDepth,
      dropped: this.droppedCount,
      totalEnqueued: this.totalEnqueuedCount,
      totalProcessed: this.totalProcessedCount,
      totalFailed: this.totalFailedCount,
    };
  }

  async flush(deadlineMs = 5000): Promise<number> {
    const start = Date.now();
    let flushed = 0;
    while (Date.now() - start < deadlineMs && this.redisDepth > 0) {
      await new Promise((r) => setTimeout(r, 100));
      flushed++;
    }
    return flushed;
  }

  async close(): Promise<void> {
    if (this.depthSampler) {
      clearInterval(this.depthSampler);
      this.depthSampler = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
    log.queue.info({ queue: this.label }, "Redis job queue closed");
  }
}
