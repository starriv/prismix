/**
 * JobQueue — Strategy interface for distributed job processing.
 *
 * Uses serializable job names + data payloads that can cross process boundaries.
 *
 * Implementation: RedisJobQueue (BullMQ, production).
 * Adding a new backend (RocketMQ, Kafka, SQS, etc.):
 *   1. Create <name>-job-queue.ts implementing this interface
 *   2. Update factory in index.ts to select it via env var
 *   3. Zero consumer changes — they use the barrel
 */

export type JobData = Record<string, unknown>;
export type JobHandler = (data: JobData) => Promise<void>;

export interface JobEnqueueOptions {
  delayMs?: number;
}

export interface JobQueueStats {
  depth: number;
  dropped: number;
  totalEnqueued: number;
  totalProcessed: number;
  totalFailed: number;
}

export interface JobQueue {
  /**
   * Enqueue a serializable job.
   * @param name — job type (e.g. "gateway-log", "notification-deliver")
   * @param data — JSON-serializable payload
   * @returns false if dropped due to backpressure
   */
  enqueue(name: string, data: JobData, options?: JobEnqueueOptions): boolean;

  /**
   * Register a handler for a job type. Must be called before any jobs arrive.
   * Each job name maps to exactly one handler.
   */
  register(name: string, handler: JobHandler): void;

  /** Current queue depth (pending + active). */
  depth(): number;

  /** Queue statistics snapshot. */
  stats(): JobQueueStats;

  /**
   * Drain remaining jobs with a deadline (ms). Used for graceful shutdown.
   * Returns the number of jobs flushed.
   */
  flush(deadlineMs?: number): Promise<number>;

  /** Graceful shutdown — stop processing, close connections. */
  close(): Promise<void>;
}
