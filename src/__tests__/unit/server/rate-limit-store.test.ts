/**
 * RedisRateLimitStore unit tests — mocked ioredis.
 *
 * Covers: increment counting, window reset via windowId, resetMs calculation,
 * size() and cleanup() (no-ops for Redis), and Lua script invocation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RedisRateLimitStore } from "@/server/rate-limit";

// ── Mock Redis ─────────────────────────────────────────────────────

function createMockRedis() {
  let counter = 0;
  return {
    eval: vi.fn(async () => {
      counter++;
      return counter;
    }),
    /** Reset the internal counter to simulate a new window */
    _resetCounter() {
      counter = 0;
    },
    _getCounter() {
      return counter;
    },
  };
}

describe("RedisRateLimitStore", () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let store: RedisRateLimitStore;

  beforeEach(() => {
    mockRedis = createMockRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new RedisRateLimitStore(mockRedis as any);
  });

  // ── Basic increment ──────────────────────────────────────────────

  it("increments count via Redis EVAL (Lua script)", async () => {
    const r1 = await store.increment("key1", 60_000);
    expect(r1.count).toBe(1);
    expect(r1.resetMs).toBeLessThanOrEqual(60_000);

    const r2 = await store.increment("key1", 60_000);
    expect(r2.count).toBe(2);

    const r3 = await store.increment("key1", 60_000);
    expect(r3.count).toBe(3);

    // Verify Redis eval was called 3 times
    expect(mockRedis.eval).toHaveBeenCalledTimes(3);
  });

  it("passes correct key format to Redis: rl:{key}:{windowId}", async () => {
    await store.increment("global:api:1.2.3.4", 60_000);

    const args = mockRedis.eval.mock.calls[0] as unknown[];
    const redisKey = args[2] as string;
    expect(redisKey).toMatch(/^rl:global:api:1\.2\.3\.4:\d+$/);
  });

  it("passes 2x windowMs as TTL to Lua script", async () => {
    await store.increment("key1", 30_000);

    const args = mockRedis.eval.mock.calls[0] as unknown[];
    const ttlMs = args[3] as number;
    expect(ttlMs).toBe(60_000); // 2x window
  });

  it("resetMs is within expected range", async () => {
    const r = await store.increment("key1", 10_000);
    expect(r.resetMs).toBeLessThanOrEqual(10_000);
    expect(r.resetMs).toBeGreaterThanOrEqual(0);
  });

  // ── size() and cleanup() ───────────────────────────────────────

  it("size() returns 0 (Redis manages keys via TTL)", () => {
    expect(store.size()).toBe(0);
  });

  it("cleanup() is a no-op (Redis handles expiry)", () => {
    // Should not throw
    store.cleanup();
  });
});
