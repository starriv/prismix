/**
 * Cache barrel — Redis-backed WriteThroughCacheStore.
 *
 * Redis (REDIS_URL) is mandatory. The factory creates a WriteThroughCacheStore
 * that provides sync local reads + async Redis writes + Pub/Sub invalidation.
 *
 * Consumers import from this barrel only:
 *   import { createCacheStore, type CacheStore } from "@/server/cache";
 */
import { getRedis } from "../lib/redis";
import type { CacheStore } from "./cache-store";
import { WriteThroughCacheStore } from "./write-through-cache-store";

// ── Public API ──────────────────────────────────────────────────────

export type { CacheStore } from "./cache-store";

// Track all WriteThroughCacheStore instances for graceful shutdown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const writeThroughInstances: WriteThroughCacheStore<any>[] = [];

/**
 * Factory: creates a CacheStore instance backed by Redis.
 *
 * @param prefix — Redis key namespace (e.g., "resource", "idempotency")
 * @param maxSize — max entries in the local cache (default 10,000)
 */
export function createCacheStore<T>(prefix: string, maxSize?: number): CacheStore<T> {
  const redis = getRedis();
  const store = new WriteThroughCacheStore<T>(redis, prefix, maxSize);
  writeThroughInstances.push(store);
  return store;
}

/** Close all WriteThroughCacheStore subscriber connections. Call during shutdown. */
export async function closeCacheStores(): Promise<void> {
  await Promise.allSettled(writeThroughInstances.map((s) => s.close()));
}

// ── Test-only export ────────────────────────────────────────────────
export { WriteThroughCacheStore } from "./write-through-cache-store";
