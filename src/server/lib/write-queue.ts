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

import { createJobQueue, type JobQueue } from "../queue";
import { log } from "./logger";

let _queue: JobQueue | null = null;
let _queueWarnedAt = 0;

// ── Micro-batch accumulator ──────────────────────────────────────────

interface BatchConfig {
  handler: (batch: Record<string, unknown>[]) => Promise<void>;
  buffer: Record<string, unknown>[];
  maxSize: number;
  flushIntervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
}

const batchConfigs = new Map<string, BatchConfig>();

async function flushBatch(name: string, config: BatchConfig): Promise<void> {
  if (config.buffer.length === 0) return;
  const batch = config.buffer.splice(0);
  try {
    await config.handler(batch);
  } catch (err) {
    log.queue.error({ err, name, batchSize: batch.length }, "Batch flush failed");
  }
}

/** Initialize the write queue. Call from bootstrap. */
export async function initWriteQueue(): Promise<JobQueue> {
  _queue = await createJobQueue(
    "write-queue",
    () => getGatewayConfigCached().queue.maxWriteQueueDepth,
  );
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
export function enqueueJob(name: string, data: Record<string, unknown>): void {
  // Check batch mode first
  const batch = batchConfigs.get(name);
  if (batch) {
    batch.buffer.push(data);
    if (batch.buffer.length >= batch.maxSize) {
      flushBatch(name, batch).catch((err) => {
        log.queue.error({ err, name }, "Unexpected batch size flush error");
      });
    }
    return;
  }

  // Standard single-item queue — graceful degradation if not initialized
  if (!_queue) {
    // Throttle warnings to once per 10s to avoid log flood under high QPS
    const now = Date.now();
    if (now - _queueWarnedAt > 10_000) {
      _queueWarnedAt = now;
      log.queue.warn({ name }, "Write queue not initialized — jobs are being dropped");
    }
    return;
  }
  _queue.enqueue(name, data);
}

export function getWriteQueueDepth(): number {
  let batchDepth = 0;
  for (const config of batchConfigs.values()) {
    batchDepth += config.buffer.length;
  }
  return (_queue?.depth() ?? 0) + batchDepth;
}

export function getWriteQueueStats() {
  return (
    _queue?.stats() ?? { depth: 0, dropped: 0, totalEnqueued: 0, totalProcessed: 0, totalFailed: 0 }
  );
}

/** Flush all batch buffers immediately. Called during graceful shutdown. */
async function flushAllBatches(): Promise<number> {
  let total = 0;
  for (const [name, config] of batchConfigs.entries()) {
    const count = config.buffer.length;
    if (count > 0) {
      await flushBatch(name, config);
      total += count;
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
  // Flush batch buffers first, then drain the BullMQ queue
  const batchFlushed = await flushAllBatches();
  const queueFlushed = await (_queue?.flush(deadlineMs) ?? Promise.resolve(0));
  return batchFlushed + queueFlushed;
}

export async function closeWriteQueue(): Promise<void> {
  stopBatchTimers();
  await flushAllBatches();
  await _queue?.close();
  _queue = null;
}
