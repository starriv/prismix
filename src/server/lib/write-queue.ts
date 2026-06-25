/**
 * Async write queue — decouples DB writes from the response path.
 *
 * Uses RedisJobQueue (BullMQ, persistent, multi-instance) via the queue barrel.
 * Redis is mandatory — there is no in-memory fallback.
 *
 * Job handlers are registered at init time. Business code calls
 * enqueueJob(name, data) with serializable payloads.
 *
 * Batch mode: high-frequency jobs can opt into micro-batching via
 * registerBatchHandler(). Payloads are accumulated in memory and flushed
 * as a single multi-row INSERT when either the batch size or flush
 * interval is reached — typically 10x throughput improvement.
 */
import { getGatewayConfigCached } from "@/server/lib/gateway-config";

import {
  createJobQueue,
  type CreateJobQueueOptions,
  type JobEnqueueOptions,
  type JobQueue,
} from "../queue";
import { log } from "./logger";

let _queue: JobQueue | null = null;
let _batchQueue: JobQueue | null = null;
let _queueWarnedAt = 0;

// Job names that use micro-batching. They route to a dedicated, high-concurrency
// batch queue instead of the shared single-item queue. Source of truth for
// producer-side routing (e.g. the API process, which never registers the batch
// handler itself). registerBatchHandler() keeps this in sync defensively.
const BATCH_JOB_NAMES = new Set<string>(["ai-usage-log"]);

// Batch-queue worker concurrency. Must comfortably exceed the largest batch
// maxSize (currently 50) so a full batch can assemble and trigger a size-based
// flush. The shared single-item queue's low concurrency would otherwise cap the
// number of in-flight (buffered, awaiting-flush) entries below maxSize, leaving
// only the periodic timer to flush — throttling throughput to ~concurrency/interval.
const BATCH_QUEUE_CONCURRENCY = 100;

// Single-item write-queue worker concurrency. Should match DB_POOL_MAX
// (default 20) so each concurrent handler gets a Postgres connection without
// pool contention. Raise both DB_POOL_MAX and this value for higher throughput.
const WRITE_QUEUE_CONCURRENCY = 20;

// ── Micro-batch accumulator ──────────────────────────────────────────

interface BatchConfig {
  handler: (batch: Record<string, unknown>[]) => Promise<void>;
  buffer: BatchEntry[];
  maxSize: number;
  flushIntervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
}

interface BatchEntry {
  data: Record<string, unknown>;
  resolve?: () => void;
  reject?: (err: Error) => void;
}

export type InitWriteQueueOptions = CreateJobQueueOptions;

const batchConfigs = new Map<string, BatchConfig>();

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

async function flushBatch(name: string, config: BatchConfig): Promise<number> {
  if (config.buffer.length === 0) return 0;
  const entries = config.buffer.splice(0);
  const batch = entries.map((entry) => entry.data);
  try {
    await config.handler(batch);
    for (const entry of entries) {
      entry.resolve?.();
    }
    return entries.length;
  } catch (err) {
    log.queue.error({ err, name, batchSize: batch.length }, "Batch flush failed");
    const error = toError(err);
    for (const entry of entries) {
      entry.reject?.(error);
    }
    return 0;
  }
}

function enqueueBatchEntry(
  name: string,
  config: BatchConfig,
  data: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    config.buffer.push({ data, resolve, reject });
    if (config.buffer.length >= config.maxSize) {
      flushBatch(name, config).catch((err) => {
        reject(toError(err));
      });
    }
  });
}

function attachBatchHandlersToQueue(queue: JobQueue): void {
  for (const [name, config] of batchConfigs.entries()) {
    queue.register(name, (data) => enqueueBatchEntry(name, config, data));
  }
}

/** Initialize the write queue. Call from bootstrap. */
export async function initWriteQueue(options?: InitWriteQueueOptions): Promise<JobQueue> {
  const maxDepth = () => getGatewayConfigCached().queue.maxWriteQueueDepth;
  _queue = await createJobQueue("write-queue", maxDepth, {
    ...options,
    concurrency: WRITE_QUEUE_CONCURRENCY,
  });

  // Dedicated batch queue with high concurrency so a full batch can assemble.
  _batchQueue = await createJobQueue("write-queue-batch", maxDepth, {
    ...options,
    concurrency: BATCH_QUEUE_CONCURRENCY,
  });
  attachBatchHandlersToQueue(_batchQueue);

  return _queue;
}

/**
 * Register a job handler on the write queue (single-item processing).
 * Must be called before any jobs of that type are enqueued.
 *
 * If the queue is not initialized, logs a warning and skips registration.
 * Jobs of this type will be silently dropped until the queue is available.
 */
export function registerWriteHandler(
  name: string,
  handler: (data: Record<string, unknown>) => Promise<void>,
): void {
  if (!_queue) {
    log.queue.warn({ name }, "Write queue not initialized — handler registration skipped");
    return;
  }
  _queue.register(name, handler);
}

/**
 * Register a batch handler for high-frequency writes.
 *
 * Payloads are accumulated in memory. Flush triggers:
 *   1. Buffer reaches `maxSize` (default 50)
 *   2. Timer fires every `flushIntervalMs` (default 1000ms)
 *   3. Graceful shutdown via flushAllBatches()
 *
 * The handler receives an array of payloads for a single multi-row INSERT.
 * Jobs of this type bypass the BullMQ queue entirely — they stay in-process.
 *
 * Trade-off: if the process crashes between accumulation and flush,
 * up to `maxSize` log entries are lost. This is acceptable for append-only
 * analytics tables (gateway_logs, ai_usage_logs) where data completeness
 * is best-effort by design.
 */
export function registerBatchHandler(
  name: string,
  handler: (batch: Record<string, unknown>[]) => Promise<void>,
  options?: { maxSize?: number; flushIntervalMs?: number },
): void {
  const maxSize = options?.maxSize ?? 50;
  const flushIntervalMs = options?.flushIntervalMs ?? 1000;
  BATCH_JOB_NAMES.add(name);
  const existing = batchConfigs.get(name);
  if (existing?.timer) {
    clearInterval(existing.timer);
  }

  const config: BatchConfig = {
    handler,
    buffer: [],
    maxSize,
    flushIntervalMs,
    timer: null,
  };

  // Start periodic flush timer
  config.timer = setInterval(() => {
    flushBatch(name, config).catch((err) => {
      log.queue.error({ err, name }, "Unexpected periodic batch flush error");
    });
  }, flushIntervalMs);

  batchConfigs.set(name, config);
  _batchQueue?.register(name, (data) => enqueueBatchEntry(name, config, data));
}

/**
 * Enqueue a serializable write job.
 *
 * If a batch handler is registered for this name, the payload is buffered
 * in memory for batched flushing. Otherwise, it goes through the BullMQ queue.
 *
 * If the queue is not initialized (bootstrap failed or still running),
 * the job is silently dropped with a warning log. This prevents unhandled
 * throws from crashing request handlers on the hot path.
 */
export function enqueueJob(
  name: string,
  data: Record<string, unknown>,
  options?: JobEnqueueOptions,
): void {
  // In-process batch mode — buffer locally when the handler runs in this process
  // (single-process / worker-local). Bypasses Redis entirely.
  const batch = batchConfigs.get(name);
  if (batch) {
    batch.buffer.push({ data });
    if (batch.buffer.length >= batch.maxSize) {
      flushBatch(name, batch).catch((err) => {
        log.queue.error({ err, name }, "Unexpected batch size flush error");
      });
    }
    return;
  }

  // Producer-only batch path (e.g. API): route to the dedicated batch queue so
  // the worker can micro-batch on consume.
  if (BATCH_JOB_NAMES.has(name)) {
    if (!_batchQueue) {
      warnQueueUninitialized(name);
      return;
    }
    _batchQueue.enqueue(name, data, options);
    return;
  }

  // Standard single-item queue — graceful degradation if not initialized
  if (!_queue) {
    warnQueueUninitialized(name);
    return;
  }
  _queue.enqueue(name, data, options);
}

/** Throttle "queue not initialized" warnings to once per 10s to avoid log flood. */
function warnQueueUninitialized(name: string): void {
  const now = Date.now();
  if (now - _queueWarnedAt > 10_000) {
    _queueWarnedAt = now;
    log.queue.warn({ name }, "Write queue not initialized — jobs are being dropped");
  }
}

export function getWriteQueueDepth(): number {
  let batchDepth = 0;
  for (const config of batchConfigs.values()) {
    batchDepth += config.buffer.length;
  }
  return (_queue?.depth() ?? 0) + (_batchQueue?.depth() ?? 0) + batchDepth;
}

export function getWriteQueueStats() {
  const empty = { depth: 0, dropped: 0, totalEnqueued: 0, totalProcessed: 0, totalFailed: 0 };
  const main = _queue?.stats() ?? empty;
  const batch = _batchQueue?.stats() ?? empty;
  return {
    depth: main.depth + batch.depth,
    dropped: main.dropped + batch.dropped,
    totalEnqueued: main.totalEnqueued + batch.totalEnqueued,
    totalProcessed: main.totalProcessed + batch.totalProcessed,
    totalFailed: main.totalFailed + batch.totalFailed,
  };
}

/** Flush all batch buffers immediately. Called during graceful shutdown. */
async function flushAllBatches(): Promise<number> {
  let total = 0;
  for (const [name, config] of batchConfigs.entries()) {
    const count = config.buffer.length;
    if (count > 0) {
      total += await flushBatch(name, config);
    }
  }
  return total;
}

/** Stop all batch timers. */
function stopBatchTimers(): void {
  for (const config of batchConfigs.values()) {
    if (config.timer) {
      clearInterval(config.timer);
      config.timer = null;
    }
  }
}

export async function flushWriteQueue(deadlineMs = 5000): Promise<number> {
  // Flush in-process batch buffers first, then drain both BullMQ queues
  const batchFlushed = await flushAllBatches();
  const [queueFlushed, batchQueueFlushed] = await Promise.all([
    _queue?.flush(deadlineMs) ?? Promise.resolve(0),
    _batchQueue?.flush(deadlineMs) ?? Promise.resolve(0),
  ]);
  return batchFlushed + queueFlushed + batchQueueFlushed;
}

export async function closeWriteQueue(): Promise<void> {
  stopBatchTimers();
  await flushAllBatches();
  await Promise.all([_queue?.close(), _batchQueue?.close()]);
  _queue = null;
  _batchQueue = null;
}
