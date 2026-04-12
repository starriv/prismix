/**
 * WriteThroughCacheStore unit tests.
 *
 * Tests the CacheStore interface: get/set/del, TTL eviction, max size,
 * pattern deletion, null/falsy values, overwrite behavior.
 *
 * Uses a mocked Redis — only the local Map+TTL layer is exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WriteThroughCacheStore } from "@/server/cache";

const mockRedis = () =>
  ({
    duplicate: () => ({
      subscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    }),
    publish: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
  }) as never;

describe("WriteThroughCacheStore", () => {
  let cache: WriteThroughCacheStore<string>;

  beforeEach(() => {
    cache = new WriteThroughCacheStore<string>(mockRedis(), "test");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic get/set/del ──────────────────────────────────────────────

  it("returns undefined for missing key", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    cache.set("k1", "v1", 10_000);
    expect(cache.get("k1")).toBe("v1");
  });

  it("deletes a key", () => {
    cache.set("k1", "v1", 10_000);
    cache.del("k1");
    expect(cache.get("k1")).toBeUndefined();
  });

  it("has() returns true for existing key", () => {
    cache.set("k1", "v1", 10_000);
    expect(cache.has("k1")).toBe(true);
  });

  it("has() returns false for missing key", () => {
    expect(cache.has("k1")).toBe(false);
  });

  it("clear() removes all entries", () => {
    cache.set("k1", "v1", 10_000);
    cache.set("k2", "v2", 10_000);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("k1")).toBeUndefined();
  });

  it("size() returns approximate count", () => {
    cache.set("k1", "v1", 10_000);
    cache.set("k2", "v2", 10_000);
    expect(cache.size()).toBe(2);
  });

  // ── TTL expiry ────────────────────────────────────────────────────

  it("expires entries after TTL", () => {
    cache.set("k1", "v1", 5_000);
    expect(cache.get("k1")).toBe("v1");

    vi.advanceTimersByTime(5_000);
    expect(cache.get("k1")).toBeUndefined();
  });

  it("has() returns false for expired entry", () => {
    cache.set("k1", "v1", 5_000);
    vi.advanceTimersByTime(5_000);
    expect(cache.has("k1")).toBe(false);
  });

  it("entry is still alive just before TTL", () => {
    cache.set("k1", "v1", 5_000);
    vi.advanceTimersByTime(4_999);
    expect(cache.get("k1")).toBe("v1");
  });

  // ── Max size bound ────────────────────────────────────────────────

  it("evicts oldest entry when exceeding maxSize", () => {
    const small = new WriteThroughCacheStore<string>(mockRedis(), "small", 3);
    small.set("a", "1", 60_000);
    small.set("b", "2", 60_000);
    small.set("c", "3", 60_000);
    expect(small.size()).toBe(3);

    small.set("d", "4", 60_000);
    expect(small.size()).toBe(3);
    expect(small.get("a")).toBeUndefined(); // oldest evicted
    expect(small.get("d")).toBe("4");
  });

  // ── Null / falsy values ───────────────────────────────────────────

  it("stores and retrieves null values (negative cache)", () => {
    const nullCache = new WriteThroughCacheStore<string | null>(mockRedis(), "null");
    nullCache.set("k1", null, 10_000);
    expect(nullCache.has("k1")).toBe(true);
    expect(nullCache.get("k1")).toBeNull();
  });

  it("stores and retrieves zero (falsy but valid)", () => {
    const numCache = new WriteThroughCacheStore<number>(mockRedis(), "num");
    numCache.set("k1", 0, 10_000);
    expect(numCache.has("k1")).toBe(true);
    expect(numCache.get("k1")).toBe(0);
  });

  // ── Pattern deletion ──────────────────────────────────────────────

  it("delByPrefix removes matching keys", () => {
    cache.set("user:1:name", "alice", 10_000);
    cache.set("user:1:email", "a@b.com", 10_000);
    cache.set("user:2:name", "bob", 10_000);
    cache.set("other:x", "x", 10_000);

    const deleted = cache.delByPrefix("user:1:");
    expect(deleted).toBe(2);
    expect(cache.get("user:1:name")).toBeUndefined();
    expect(cache.get("user:2:name")).toBe("bob");
    expect(cache.get("other:x")).toBe("x");
  });

  it("delBySuffix removes matching keys", () => {
    cache.set("1:/api/foo", "r1", 10_000);
    cache.set("2:/api/foo", "r2", 10_000);
    cache.set("1:/api/bar", "r3", 10_000);

    const deleted = cache.delBySuffix(":/api/foo");
    expect(deleted).toBe(2);
    expect(cache.get("1:/api/foo")).toBeUndefined();
    expect(cache.get("2:/api/foo")).toBeUndefined();
    expect(cache.get("1:/api/bar")).toBe("r3");
  });

  it("delByPrefix returns 0 when no match", () => {
    cache.set("k1", "v1", 10_000);
    expect(cache.delByPrefix("zzz")).toBe(0);
  });

  // ── Overwrite ─────────────────────────────────────────────────────

  it("overwrites existing key with new value and TTL", () => {
    cache.set("k1", "v1", 5_000);
    cache.set("k1", "v2", 10_000);
    expect(cache.get("k1")).toBe("v2");

    vi.advanceTimersByTime(5_000);
    expect(cache.get("k1")).toBe("v2"); // still alive with new TTL

    vi.advanceTimersByTime(5_000);
    expect(cache.get("k1")).toBeUndefined(); // now expired
  });
});
