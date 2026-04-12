/**
 * AI Request Log Store — factory barrel.
 *
 * Creates a RequestLogStore backed by Redis. Lazy singleton — initialized on first call.
 * If Redis is unavailable, operations are no-op (never break the hot path).
 *
 * Usage:
 *   import { saveRequestLog, getRequestLog } from "@/server/ai/log-store";
 */
import { getRedis } from "@/server/lib/redis";

import { RedisRequestLogStore } from "./redis-request-log-store";
import type { RequestLogEntry, RequestLogStore } from "./request-log-store";

export type { RequestLogEntry, RequestLogStore };

let store: RequestLogStore | null = null;

function getStore(): RequestLogStore {
  if (!store) {
    const redis = getRedis();
    const ttlDays = Number(process.env.AI_REQUEST_LOG_TTL_DAYS) || 7;
    store = new RedisRequestLogStore(redis, ttlDays);
  }
  return store;
}

/** Save a request log entry. Fire-and-forget — never throws. */
export async function saveRequestLog(entry: RequestLogEntry): Promise<void> {
  return getStore().save(entry);
}

/** Retrieve a request log by requestId. Returns null if not found or expired. */
export async function getRequestLog(requestId: string): Promise<RequestLogEntry | null> {
  return getStore().get(requestId);
}

/** Graceful shutdown. */
export async function closeRequestLogStore(): Promise<void> {
  if (store) {
    await store.close();
    store = null;
  }
}
