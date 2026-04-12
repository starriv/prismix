/**
 * Semantic cache — Phase 3 Feature 4 unit tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCacheKey,
  clearCache,
  getCachedResponse,
  getCacheSize,
  setCachedResponse,
} from "@/server/ai/lib/semantic-cache";

// Mock CacheStore with a simple in-memory Map to avoid Redis dependency
const mockMap = new Map<string, { value: string; expiresAt: number }>();

vi.mock("@/server/cache", () => ({
  createCacheStore: () => ({
    get(key: string) {
      const entry = mockMap.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        mockMap.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: string, ttlMs: number) {
      mockMap.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    del(key: string) {
      mockMap.delete(key);
    },
    has(key: string) {
      return mockMap.has(key);
    },
    clear() {
      mockMap.clear();
    },
    size() {
      return mockMap.size;
    },
  }),
}));

vi.mock("@/server/lib/logger", () => ({
  log: { gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

afterEach(() => {
  clearCache();
  mockMap.clear();
});

describe("buildCacheKey", () => {
  it("produces deterministic keys for same input", () => {
    const msgs = [{ role: "user" as const, content: "hello" }];
    const k1 = buildCacheKey("gpt-4o", msgs);
    const k2 = buildCacheKey("gpt-4o", msgs);
    expect(k1).toBe(k2);
  });

  it("produces different keys for different models", () => {
    const msgs = [{ role: "user" as const, content: "hello" }];
    expect(buildCacheKey("gpt-4o", msgs)).not.toBe(buildCacheKey("gpt-4o-mini", msgs));
  });

  it("produces different keys for different messages", () => {
    expect(buildCacheKey("gpt-4o", [{ role: "user", content: "hello" }])).not.toBe(
      buildCacheKey("gpt-4o", [{ role: "user", content: "world" }]),
    );
  });

  it("key starts with ai-cache: prefix", () => {
    const key = buildCacheKey("gpt-4o", [{ role: "user", content: "hi" }]);
    expect(key).toMatch(/^ai-cache:[a-f0-9]{64}$/);
  });
});

describe("get/set cache", () => {
  it("returns null on cache miss", () => {
    expect(getCachedResponse("nonexistent")).toBeNull();
  });

  it("stores and retrieves a response", () => {
    const key = "test-key";
    const response = { id: "chat-1", choices: [{ message: { content: "hi" } }] };
    setCachedResponse(key, response);
    expect(getCachedResponse(key)).toEqual(response);
  });

  it("returns null for expired entries", async () => {
    const key = "expired-key";
    setCachedResponse(key, { data: "old" }, 1); // 1ms TTL
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));
    expect(getCachedResponse(key)).toBeNull();
  });

  it("clearCache empties the store", () => {
    setCachedResponse("k1", { a: 1 });
    setCachedResponse("k2", { b: 2 });
    expect(getCacheSize()).toBe(2);
    clearCache();
    expect(getCacheSize()).toBe(0);
  });
});
