/**
 * RedisRateLimitStore — distributed sliding-window rate limiter backed by Redis.
 *
 * Used when REDIS_URL is set (multi-instance / production).
 * Each increment is a single Redis round-trip using an atomic Lua script
 * (INCR + PEXPIRE in one call), so it costs ~0.5-2ms per request.
 *
 * Key format: `rl:{key}:{windowId}` where windowId = floor(now / windowMs)
 * so all requests within the same window share one Redis key.
 * TTL is set to 2x windowMs to ensure cleanup even if no further requests arrive.
 */
import type Redis from "ioredis";

import type { RateLimitResult, RateLimitStore } from "./rate-limit-store";

/**
 * Lua script: atomically INCR + set PEXPIRE only if the key is new.
 * Returns the new count.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = TTL in ms (2x window)
 *
 * Using PEXPIRE NX-like behavior: set expiry only when the key is fresh
 * (TTL == -1 means no expiry set yet → key was just created by INCR).
 */
const INCR_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if redis.call('PTTL', KEYS[1]) == -1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

const KEY_PREFIX = "rl:";

export class RedisRateLimitStore implements RateLimitStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowId = Math.floor(now / windowMs);
    const redisKey = `${KEY_PREFIX}${key}:${windowId}`;
    const ttlMs = windowMs * 2; // 2x window for safety

    const count = (await this.redis.eval(INCR_SCRIPT, 1, redisKey, ttlMs)) as number;

    // resetMs = time until the current window expires
    const windowStart = windowId * windowMs;
    const resetMs = Math.max(0, windowStart + windowMs - now);

    return { count, resetMs };
  }

  size(): number {
    // Redis keys are managed by TTL — no local state to count.
    // Return 0 as a placeholder; the real count is in Redis.
    return 0;
  }

  cleanup(): void {
    // Redis keys expire automatically via PEXPIRE — no manual cleanup needed.
  }
}
