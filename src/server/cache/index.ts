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

/**
 * Lazy cache store — returns a CacheStore<T> proxy that defers the real
 * `createCacheStore()` call until first use. This prevents eager Redis
 * connections during module load (before bootstrap() has connected Redis).
 *
 * Use this for **module-level** singletons; inside functions that only run
 * after bootstrap, plain `createCacheStore()` is fine.
 */
export function lazyCacheStore<T>(prefix: string, maxSize?: number): CacheStore<T> {
  let _inner: CacheStore<T> | null = null;
  function inner(): CacheStore<T> {
    if (!_inner) _inner = createCacheStore<T>(prefix, maxSize);
    return _inner;
  }
  return {
    get: (key) => inner().get(key),
    set: (key, value, ttlMs) => inner().set(key, value, ttlMs),
    del: (key) => inner().del(key),
    has: (key) => inner().has(key),
    clear: () => inner().clear(),
    size: () => inner().size(),
    delByPrefix: (p) => inner().delByPrefix(p),
    delBySuffix: (s) => inner().delBySuffix(s),
  };
}

/** Close all WriteThroughCacheStore subscriber connections. Call during shutdown. */
export async function closeCacheStores(): Promise<void> {
  await Promise.allSettled(writeThroughInstances.map((s) => s.close()));
}

// ── Test-only export ────────────────────────────────────────────────
export { WriteThroughCacheStore } from "./write-through-cache-store";
