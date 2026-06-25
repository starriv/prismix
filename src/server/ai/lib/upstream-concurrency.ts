/**
 * Upstream concurrency control — Redis-backed distributed admission queue.
 *
 * Scope is the numeric ai_upstreams.id. Legacy provider base URLs (upstreamId=null)
 * are intentionally unlimited until they are normalized into real upstream rows.
 */
import { randomUUID } from "node:crypto";

import { getGatewayConfigCached, resolveTimeoutConfig } from "@/server/lib/gateway-config";
import { log } from "@/server/lib/logger";
import {
  aiUpstreamConcurrencyAcquireTotal,
  aiUpstreamConcurrencyActive,
  aiUpstreamConcurrencyTimeoutTotal,
  aiUpstreamConcurrencyWaitDuration,
  aiUpstreamConcurrencyWaiting,
} from "@/server/lib/metrics";
import { getRedis } from "@/server/lib/redis";

const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const POLL_JITTER_MS = 50;
const ACTIVE_TTL_BUFFER_MS = 60_000;

const ACQUIRE_SCRIPT = `
  local activeKey = KEYS[1]
  local waitingKey = KEYS[2]

  local now = tonumber(ARGV[1])
  local activeTtlMs = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local token = ARGV[4]
  local waitingStaleBefore = tonumber(ARGV[5])
  local shouldEnqueue = ARGV[6] == "1"

  redis.call("ZREMRANGEBYSCORE", activeKey, "-inf", now)
  redis.call("ZREMRANGEBYSCORE", waitingKey, "-inf", waitingStaleBefore)

  local activeCount = redis.call("ZCARD", activeKey)
  local waitingCount = redis.call("ZCARD", waitingKey)

  if activeCount < limit and waitingCount == 0 then
    redis.call("ZADD", activeKey, now + activeTtlMs, token)
    return {1, activeCount + 1, 0, 0}
  end

  if shouldEnqueue then
    redis.call("ZADD", waitingKey, now, token)
  end

  local first = redis.call("ZRANGE", waitingKey, 0, 0)[1]
  if activeCount < limit and first == token then
    redis.call("ZREM", waitingKey, token)
    redis.call("ZADD", activeKey, now + activeTtlMs, token)
    return {1, activeCount + 1, redis.call("ZCARD", waitingKey), 0}
  end

  local rank = redis.call("ZRANK", waitingKey, token)
  if rank == false then
    return {0, activeCount, redis.call("ZCARD", waitingKey), 0}
  end

  return {0, activeCount, redis.call("ZCARD", waitingKey), rank + 1}
`;

const RELEASE_SCRIPT = `
  redis.call("ZREM", KEYS[1], ARGV[1])
  redis.call("ZREM", KEYS[2], ARGV[1])
  return {redis.call("ZCARD", KEYS[1]), redis.call("ZCARD", KEYS[2])}
`;

export interface AcquireUpstreamSlotOptions {
  upstreamId: number | null;
  concurrencyLimit?: number | null;
  queueTimeoutMs?: number | null;
  requestId?: string;
  providerId?: string;
  modelId?: string;
}

export interface UpstreamConcurrencyLease {
  upstreamId: number;
  token: string;
  activeKey: string;
  waitingKey: string;
  acquiredAt: number;
  waitedMs: number;
  limit: number;
}

export class UpstreamConcurrencyTimeoutError extends Error {
  readonly statusCode = 429;
  readonly upstreamId: number;
  readonly timeoutMs: number;

  constructor(upstreamId: number, timeoutMs: number) {
    super(`Timed out waiting for upstream ${upstreamId} concurrency slot after ${timeoutMs}ms`);
    this.name = "UpstreamConcurrencyTimeoutError";
    this.upstreamId = upstreamId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Map an acquireUpstreamSlot failure into a relay-compatible lastError shape.
 * Concurrency timeouts yield 429 (so clients can retry); other errors yield 503.
 * Used by both consumer-relay.ts and relay.ts.
 */
export function toConcurrencyLastError(err: unknown): { status: number; message: string } {
  if (err instanceof UpstreamConcurrencyTimeoutError) {
    return { status: err.statusCode, message: err.message };
  }
  return {
    status: 503,
    message: err instanceof Error ? err.message : String(err),
  };
}

interface AcquireScriptResult {
  acquired: boolean;
  active: number;
  waiting: number;
  position: number;
}

function isPositiveInt(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function keyPrefix(upstreamId: number): string {
  return `ai:upstream-concurrency:${upstreamId}`;
}

function resolveActiveTtlMs(): number {
  const timeouts = resolveTimeoutConfig(getGatewayConfigCached().timeouts);
  return timeouts.streamMaxDurationMs + ACTIVE_TTL_BUFFER_MS;
}

function normalizeQueueTimeoutMs(value: number | null | undefined): number {
  return isPositiveInt(value) ? value : DEFAULT_QUEUE_TIMEOUT_MS;
}

function parseAcquireResult(raw: unknown): AcquireScriptResult {
  if (!Array.isArray(raw) || raw.length < 4) {
    throw new Error("Unexpected upstream concurrency acquire script result");
  }
  const [acquired, active, waiting, position] = raw.map((item) => Number(item));
  return {
    acquired: acquired === 1,
    active: Number.isFinite(active) ? active : 0,
    waiting: Number.isFinite(waiting) ? waiting : 0,
    position: Number.isFinite(position) ? position : 0,
  };
}

function parseCounts(raw: unknown): { active: number; waiting: number } {
  if (!Array.isArray(raw) || raw.length < 2) return { active: 0, waiting: 0 };
  return {
    active: Number(raw[0]) || 0,
    waiting: Number(raw[1]) || 0,
  };
}

function observeCounts(upstreamId: number, counts: { active: number; waiting: number }): void {
  const label = String(upstreamId);
  aiUpstreamConcurrencyActive.set({ upstream_id: label }, counts.active);
  aiUpstreamConcurrencyWaiting.set({ upstream_id: label }, counts.waiting);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function releaseToken(activeKey: string, waitingKey: string, token: string): Promise<void> {
  const raw = await getRedis().eval(RELEASE_SCRIPT, 2, activeKey, waitingKey, token);
  const upstreamId = Number(activeKey.split(":").pop());
  if (Number.isInteger(upstreamId)) {
    observeCounts(upstreamId, parseCounts(raw));
  }
}

export async function acquireUpstreamSlot(
  options: AcquireUpstreamSlotOptions,
): Promise<UpstreamConcurrencyLease | null> {
  if (!isPositiveInt(options.upstreamId) || !isPositiveInt(options.concurrencyLimit)) {
    return null;
  }

  const upstreamId = options.upstreamId;
  const limit = options.concurrencyLimit;
  const queueTimeoutMs = normalizeQueueTimeoutMs(options.queueTimeoutMs);
  const prefix = keyPrefix(upstreamId);
  const activeKey = `${prefix}:active`;
  const waitingKey = `${prefix}:waiting`;
  const token = `${process.pid}:${Date.now()}:${randomUUID()}`;
  const startedAt = Date.now();
  const deadline = startedAt + queueTimeoutMs;
  const activeTtlMs = resolveActiveTtlMs();
  let shouldEnqueue = true;

  while (Date.now() <= deadline) {
    const now = Date.now();
    const waitingStaleBefore = now - queueTimeoutMs;
    const raw = await getRedis().eval(
      ACQUIRE_SCRIPT,
      2,
      activeKey,
      waitingKey,
      now,
      activeTtlMs,
      limit,
      token,
      waitingStaleBefore,
      shouldEnqueue ? "1" : "0",
    );
    shouldEnqueue = false;

    const result = parseAcquireResult(raw);
    observeCounts(upstreamId, result);

    if (result.acquired) {
      const waitedMs = Date.now() - startedAt;
      aiUpstreamConcurrencyAcquireTotal.inc({
        upstream_id: String(upstreamId),
        outcome: waitedMs > POLL_INTERVAL_MS ? "waited" : "immediate",
      });
      aiUpstreamConcurrencyWaitDuration.observe(
        { upstream_id: String(upstreamId) },
        waitedMs / 1000,
      );
      if (waitedMs > POLL_INTERVAL_MS) {
        log.gateway.info(
          {
            requestId: options.requestId,
            providerId: options.providerId,
            modelId: options.modelId,
            upstreamId,
            waitedMs,
            limit,
          },
          "Acquired upstream concurrency slot after waiting",
        );
      }
      return {
        upstreamId,
        token,
        activeKey,
        waitingKey,
        acquiredAt: Date.now(),
        waitedMs,
        limit,
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const jitter = Math.floor(Math.random() * POLL_JITTER_MS);
    await sleep(Math.min(POLL_INTERVAL_MS + jitter, remainingMs));
  }

  await releaseToken(activeKey, waitingKey, token).catch((err) => {
    log.gateway.warn(
      { err, upstreamId, requestId: options.requestId },
      "Failed to leave upstream concurrency wait queue",
    );
  });
  aiUpstreamConcurrencyTimeoutTotal.inc({ upstream_id: String(upstreamId) });
  log.gateway.warn(
    {
      requestId: options.requestId,
      providerId: options.providerId,
      modelId: options.modelId,
      upstreamId,
      queueTimeoutMs,
      limit,
    },
    "Timed out waiting for upstream concurrency slot",
  );
  throw new UpstreamConcurrencyTimeoutError(upstreamId, queueTimeoutMs);
}

export async function releaseUpstreamSlot(lease: UpstreamConcurrencyLease | null): Promise<void> {
  if (!lease) return;
  await releaseToken(lease.activeKey, lease.waitingKey, lease.token).catch((err) => {
    log.gateway.error(
      { err, upstreamId: lease.upstreamId },
      "Failed to release upstream concurrency slot",
    );
  });
}
