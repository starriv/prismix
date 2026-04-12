/**
 * CacheStore — Strategy interface for key-value caching.
 *
 * Implementation: WriteThroughCacheStore (Redis-backed with local reads).
 * Created via `createCacheStore()` factory in index.ts.
 *
 * Interface is **synchronous** — cache lives on the gateway hot path where
 * async overhead matters. WriteThroughCacheStore uses write-through pattern
 * (sync reads from local Map, async writes to Redis, Pub/Sub for cross-process
 * invalidation).
 */

export interface CacheStore<T> {
  /** Get a value by key. Returns undefined on miss or TTL expiry. */
  get(key: string): T | undefined;

  /** Set a value with a TTL in milliseconds. */
  set(key: string, value: T, ttlMs: number): void;

  /** Delete a single key. */
  del(key: string): void;

  /** Check if a non-expired entry exists for the key. */
  has(key: string): boolean;

  /** Remove all entries. */
  clear(): void;

  /** Approximate entry count (may include expired entries). */
  size(): number;

  /** Delete all entries whose key starts with `prefix`. Returns count deleted. */
  delByPrefix(prefix: string): number;

  /** Delete all entries whose key ends with `suffix`. Returns count deleted. */
  delBySuffix(suffix: string): number;
}
