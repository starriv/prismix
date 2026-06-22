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
  const keyInput = (overrides: Record<string, unknown> = {}) => ({
    scope: "consumer:1",
    model: "gpt-4o",
    providerId: "openai",
    upstreamId: 10,
    requestBody: {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    },
    ...overrides,
  });

  it("produces deterministic keys for same input", () => {
    const k1 = buildCacheKey(keyInput());
    const k2 = buildCacheKey(keyInput());
    expect(k1).toBe(k2);
  });

  it("produces different keys for different models", () => {
    expect(buildCacheKey(keyInput({ model: "gpt-4o" }))).not.toBe(
      buildCacheKey(
        keyInput({
          model: "gpt-4o-mini",
          requestBody: {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "hello" }],
          },
        }),
      ),
    );
  });

  it("produces different keys for different messages", () => {
    expect(buildCacheKey(keyInput())).not.toBe(
      buildCacheKey(
        keyInput({
          requestBody: {
            model: "gpt-4o",
            messages: [{ role: "user", content: "world" }],
          },
        }),
      ),
    );
  });

  it("produces different keys for different request parameters", () => {
    expect(buildCacheKey(keyInput())).not.toBe(
      buildCacheKey(
        keyInput({
          requestBody: {
            model: "gpt-4o",
            messages: [{ role: "user", content: "hello" }],
            temperature: 0.7,
          },
        }),
      ),
    );
  });

  it("produces different keys for different scopes", () => {
    expect(buildCacheKey(keyInput({ scope: "consumer:1" }))).not.toBe(
      buildCacheKey(keyInput({ scope: "consumer:2" })),
    );
  });

  it("key starts with ai-cache: prefix", () => {
    const key = buildCacheKey(keyInput());
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
