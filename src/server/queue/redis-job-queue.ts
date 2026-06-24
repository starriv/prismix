/**
 * RedisJobQueue — distributed job queue via BullMQ (Redis-backed).
 *
 * Used in production when REDIS_URL is set. Provides:
 *   - Persistence — jobs survive process restarts
 *   - Multi-instance — workers on any instance can process jobs
 *   - Retry — failed jobs are retried with exponential backoff
 *   - Backpressure — max queue depth enforcement
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
        removeOnComplete: { count: 1000 }, // keep last 1000 completed
        removeOnFail: { count: 5000 }, // keep last 5000 failed for debugging
      },
    });

    if (options?.startWorker !== false) {
      // Create worker that dispatches to registered handlers
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
    // BullMQ doesn't have built-in max depth — we check getJobCounts sync-ish
    // For performance, we track our own counter instead of querying Redis every time
    if (this.totalEnqueuedCount - this.totalProcessedCount - this.totalFailedCount > currentMax) {
      this.droppedCount++;
      log.queue.warn(
        { queue: this.label, job: name, maxDepth: currentMax },
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
      // Enqueue failed — revert the counter so depth estimate stays accurate
      this.totalEnqueuedCount--;
      this.totalFailedCount++;
      log.queue.error({ err, queue: this.label, job: name }, "Failed to enqueue job");
    });
    return true;
  }

  depth(): number {
    return Math.max(0, this.totalEnqueuedCount - this.totalProcessedCount - this.totalFailedCount);
  }

  stats(): JobQueueStats {
    return {
      depth: this.depth(),
      dropped: this.droppedCount,
      totalEnqueued: this.totalEnqueuedCount,
      totalProcessed: this.totalProcessedCount,
      totalFailed: this.totalFailedCount,
    };
  }

  async flush(deadlineMs = 5000): Promise<number> {
    // Wait for worker to finish current jobs
    const start = Date.now();
    let flushed = 0;
    while (Date.now() - start < deadlineMs && this.depth() > 0) {
      await new Promise((r) => setTimeout(r, 100));
      flushed++;
    }
    return flushed;
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
    log.queue.info({ queue: this.label }, "Redis job queue closed");
  }
}
