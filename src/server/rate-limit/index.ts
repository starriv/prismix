/**
 * Rate-limit barrel — Redis-backed distributed rate limiter.
 *
 * Redis (REDIS_URL) is mandatory. Creates a RedisRateLimitStore for
 * distributed, shared-across-instances rate limiting.
 *
 * Consumers import from this barrel only:
 *   import { createRateLimitStore, type RateLimitStore } from "@/server/rate-limit";
 */
import { getRedis } from "@/server/lib/redis";

import type { RateLimitStore } from "./rate-limit-store";
import { RedisRateLimitStore } from "./redis-rate-limit-store";

// ── Public API ──────────────────────────────────────────────────────

export type { RateLimitResult, RateLimitStore } from "./rate-limit-store";

/**
 * Factory: creates a RateLimitStore instance backed by Redis.
 */
export function createRateLimitStore(): RateLimitStore {
  const redis = getRedis();
  return new RedisRateLimitStore(redis);
}

// ── Test-only exports ───────────────────────────────────────────────

export { RedisRateLimitStore } from "./redis-rate-limit-store";
