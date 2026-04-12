/**
 * Write-through cache store — Redis-backed with local in-memory reads.
 *
 * Implements the CacheStore<T> interface (synchronous) while adding:
 * - **Reads**: Zero-latency from in-process Map + TTL (hot path)
 * - **Writes**: Sync to local + fire-and-forget async to Redis
 * - **Invalidation**: Redis Pub/Sub broadcasts deletes to all processes
 * - **Degradation**: If Redis is down, local cache still works
 */
import type { Redis } from "ioredis";
import { LRUCache } from "lru-cache";

import { log } from "@/server/lib/logger";

import type { CacheStore } from "./cache-store";

// ── LRU local cache with per-entry TTL ─────────────────────────────

const DEFAULT_MAX_SIZE = 10_000;

class LocalCache<T> {
  // LRUCache requires V extends {} — we use NonNullable<T> internally
  // and handle null/undefined at the get/set boundary
  private store: LRUCache<string, NonNullable<T>>;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.store = new LRUCache<string, NonNullable<T>>({
      max: maxSize,
      allowStale: false,
    });
  }

  get(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, value as NonNullable<T>, { ttl: ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  delByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  delBySuffix(suffix: string): number {
    let deleted = 0;
    for (const key of this.store.keys()) {
      if (key.endsWith(suffix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}

// ── WriteThroughCacheStore ──────────────────────────────────────────

export class WriteThroughCacheStore<T> implements CacheStore<T> {
  private local: LocalCache<T>;
  private redis: Redis;
  private sub: Redis;
  private prefix: string;
  private channel: string;

  constructor(redis: Redis, prefix: string, maxSize?: number) {
    this.local = new LocalCache<T>(maxSize);
    this.redis = redis;
    this.prefix = prefix;
    this.channel = `cache:inv:${prefix}`;

    // Subscribe to invalidation events from other processes
    this.sub = redis.duplicate();
    this.sub.subscribe(this.channel).catch((err) => {
      log.redis.warn({ err, channel: this.channel }, "Cache Pub/Sub subscribe failed");
    });
    this.sub.on("message", (_ch: string, msg: string) => {
      if (msg === "*") {
        this.local.clear();
      } else if (msg.startsWith("__prefix:")) {
        this.local.delByPrefix(msg.slice(9));
      } else if (msg.startsWith("__suffix:")) {
        this.local.delBySuffix(msg.slice(9));
      } else {
        this.local.del(msg);
      }
    });
  }

  get(key: string): T | undefined {
    return this.local.get(key);
  }

  set(key: string, value: T, ttlMs: number): void {
    this.local.set(key, value, ttlMs);
    const rKey = `${this.prefix}:${key}`;
    this.redis.set(rKey, JSON.stringify(value), "PX", ttlMs).catch((err) => {
      log.redis.warn({ err, key: rKey }, "Cache Redis SET failed");
    });
  }

  del(key: string): void {
    this.local.del(key);
    const rKey = `${this.prefix}:${key}`;
    this.redis.del(rKey).catch((err) => {
      log.redis.warn({ err, key: rKey }, "Cache Redis DEL failed");
    });
    this.redis.publish(this.channel, key).catch((err) => {
      log.redis.warn({ err, channel: this.channel }, "Cache invalidation publish failed");
    });
  }

  has(key: string): boolean {
    return this.local.has(key);
  }

  clear(): void {
    this.local.clear();
    this.redis.publish(this.channel, "*").catch((err) => {
      log.redis.warn({ err, channel: this.channel }, "Cache clear publish failed");
    });
  }

  size(): number {
    return this.local.size();
  }

  delByPrefix(prefix: string): number {
    const deleted = this.local.delByPrefix(prefix);
    if (deleted > 0) {
      this.redis.publish(this.channel, `__prefix:${prefix}`).catch((err) => {
        log.redis.warn({ err, channel: this.channel }, "Cache prefix invalidation publish failed");
      });
    }
    return deleted;
  }

  delBySuffix(suffix: string): number {
    const deleted = this.local.delBySuffix(suffix);
    if (deleted > 0) {
      this.redis.publish(this.channel, `__suffix:${suffix}`).catch((err) => {
        log.redis.warn({ err, channel: this.channel }, "Cache suffix invalidation publish failed");
      });
    }
    return deleted;
  }

  async close(): Promise<void> {
    try {
      await this.sub.unsubscribe(this.channel);
      await this.sub.quit();
    } catch {
      // Best-effort — already shutting down
    }
  }
}
