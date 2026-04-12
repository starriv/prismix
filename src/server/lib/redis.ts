/**
 * Redis connection singleton — powered by ioredis.
 *
 * REDIS_URL is mandatory. All infrastructure layers (cache, queue,
 * rate-limit, events) require Redis.
 */
import Redis from "ioredis";

import { log } from "./logger";

let redis: Redis | null = null;

/**
 * Get the shared Redis instance. Throws if REDIS_URL is not configured.
 */
export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        "REDIS_URL is required — Redis is mandatory for cache, queue, rate-limit, and events",
      );
    }
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on("error", (err) => {
      log.redis.error({ err }, "Connection error");
    });
  }
  return redis;
}

/** Connect to Redis (call at startup). Throws if REDIS_URL is not set. */
export async function initRedis(): Promise<void> {
  const r = getRedis();
  await r.connect();
  log.redis.info("Connected");
}

/** Graceful shutdown — disconnect from Redis. */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
