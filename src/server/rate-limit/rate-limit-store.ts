/**
 * RateLimitStore — Strategy interface for sliding-window rate limiting.
 *
 * Implementation: RedisRateLimitStore (distributed, shared across instances).
 * Created via `createRateLimitStore()` factory in index.ts.
 *
 * Each call to `increment()` atomically increments the counter for a key within
 * a sliding window and returns the current count. The caller decides whether
 * the count exceeds the limit.
 */

export interface RateLimitResult {
  /** Current request count within the window (after this increment). */
  count: number;
  /** Milliseconds until the current window resets. */
  resetMs: number;
}

export interface RateLimitStore {
  /**
   * Increment the counter for `key` within a sliding window of `windowMs`.
   * Returns the current count and time until reset.
   */
  increment(key: string, windowMs: number): Promise<RateLimitResult>;

  /** Number of tracked windows (for /metrics). */
  size(): number;

  /** Cleanup expired entries. Called periodically or on shutdown. */
  cleanup(): void;
}
