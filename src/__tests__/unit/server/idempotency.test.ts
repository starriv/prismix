/**
 * Idempotency mechanism tests.
 *
 * P0:  Transaction txHash dedup — facilitator skips duplicate settlement
 * P1a: Webhook deterministic eventId + UNIQUE catch in consumer
 * P1b: Webhook retry CAS lock — claimForRetry prevents double pickup
 * P2:  Idempotency-Key middleware — cache hit returns stored response
 * P3:  Notification dedupeKey — dispatcher skips duplicate notifications
 */
import crypto from "crypto";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateDeterministicEventId, generateEventId } from "@/server/messaging/webhooks/deliver";

// The idempotency middleware caches responses via `lazyCacheStore` from
// `@/server/cache`, which is Redis-backed in production. Mock it with a
// simple in-memory store so the middleware's cache-hit/miss logic is
// exercised without a live REDIS_URL.
vi.mock("@/server/cache", () => {
  const stores = new Map<string, Map<string, unknown>>();
  function lazyCacheStore<T>(prefix: string) {
    let store = stores.get(prefix);
    if (!store) {
      store = new Map();
      stores.set(prefix, store);
    }
    return {
      get: (key: string) => store!.get(key) as T | undefined,
      set: (key: string, value: T) => {
        store!.set(key, value);
      },
      del: (key: string) => {
        store!.delete(key);
      },
      has: (key: string) => store!.has(key),
      clear: () => {
        store!.clear();
      },
      size: () => store!.size,
      delByPrefix: (prefix: string) => {
        let n = 0;
        for (const k of [...store!.keys()]) {
          if (k.startsWith(prefix)) {
            store!.delete(k);
            n++;
          }
        }
        return n;
      },
      delBySuffix: (suffix: string) => {
        let n = 0;
        for (const k of [...store!.keys()]) {
          if (k.endsWith(suffix)) {
            store!.delete(k);
            n++;
          }
        }
        return n;
      },
    };
  }
  return { lazyCacheStore, createCacheStore: lazyCacheStore };
});

// ═════════════════════════════════════════════════════════════════════
// P0: Transaction txHash dedup in facilitator
// ═════════════════════════════════════════════════════════════════════

describe("P0: facilitator transaction txHash dedup", () => {
  // We test the dedup logic by simulating what facilitator.ts does:
  // if txHash exists → skip insert
  const mockFindByTxHash = vi.fn();
  const mockInsert = vi.fn();

  async function simulateSettlement(txHash: string | null) {
    if (txHash) {
      const existing = await mockFindByTxHash(txHash);
      if (existing) return "skipped";
    }
    await mockInsert({ txHash });
    return "inserted";
  }

  beforeEach(() => {
    mockFindByTxHash.mockReset();
    mockInsert.mockReset();
  });

  it("inserts transaction when txHash is new", async () => {
    mockFindByTxHash.mockResolvedValue(undefined);
    const result = await simulateSettlement("0xabc123");
    expect(result).toBe("inserted");
    expect(mockFindByTxHash).toHaveBeenCalledWith("0xabc123");
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("skips insert when txHash already exists", async () => {
    mockFindByTxHash.mockResolvedValue({ id: 1, txHash: "0xabc123", status: "settled" });
    const result = await simulateSettlement("0xabc123");
    expect(result).toBe("skipped");
    expect(mockFindByTxHash).toHaveBeenCalledWith("0xabc123");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("inserts transaction when txHash is null (no dedup check)", async () => {
    const result = await simulateSettlement(null);
    expect(result).toBe("inserted");
    expect(mockFindByTxHash).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("two rapid calls with same txHash: only first inserts", async () => {
    mockFindByTxHash.mockResolvedValueOnce(undefined);
    mockFindByTxHash.mockResolvedValueOnce({ id: 1, txHash: "0xdup" });

    const r1 = await simulateSettlement("0xdup");
    const r2 = await simulateSettlement("0xdup");
    expect(r1).toBe("inserted");
    expect(r2).toBe("skipped");
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// P1a: Webhook deterministic eventId
// ═════════════════════════════════════════════════════════════════════

describe("P1a: webhook deterministic eventId", () => {
  describe("generateDeterministicEventId", () => {
    it("same inputs → same ID (deterministic)", () => {
      const a = generateDeterministicEventId("tx.settled", 42, 1700000000);
      const b = generateDeterministicEventId("tx.settled", 42, 1700000000);
      expect(a).toBe(b);
    });

    it("different event type → different ID", () => {
      const a = generateDeterministicEventId("tx.settled", 42, 1700000000);
      const b = generateDeterministicEventId("tx.failed", 42, 1700000000);
      expect(a).not.toBe(b);
    });

    it("different endpoint → different ID", () => {
      const a = generateDeterministicEventId("tx.settled", 1, 1700000000);
      const b = generateDeterministicEventId("tx.settled", 2, 1700000000);
      expect(a).not.toBe(b);
    });

    it("different timestamp → different ID", () => {
      const a = generateDeterministicEventId("tx.settled", 42, 1700000000);
      const b = generateDeterministicEventId("tx.settled", 42, 1700000001);
      expect(a).not.toBe(b);
    });

    it("format: evt_ prefix + 16 hex chars", () => {
      const id = generateDeterministicEventId("tx.settled", 1, Date.now());
      expect(id).toMatch(/^evt_[a-f0-9]{16}$/);
    });
  });

  describe("webhook consumer UNIQUE catch pattern", () => {
    const mockInsert = vi.fn();

    async function simulateWebhookInsert(eventId: string) {
      try {
        await mockInsert({ eventId });
        return "inserted";
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          return "skipped";
        }
        throw err;
      }
    }

    beforeEach(() => mockInsert.mockReset());

    it("first insert succeeds", async () => {
      mockInsert.mockResolvedValue({ id: 1 });
      const result = await simulateWebhookInsert("evt_abc123");
      expect(result).toBe("inserted");
    });

    it("duplicate insert (UNIQUE violation) is caught and skipped", async () => {
      mockInsert.mockRejectedValueOnce(
        new Error("UNIQUE constraint failed: webhook_deliveries.event_id"),
      );
      const result = await simulateWebhookInsert("evt_abc123");
      expect(result).toBe("skipped");
    });

    it("non-UNIQUE errors are re-thrown", async () => {
      mockInsert.mockRejectedValueOnce(new Error("Connection lost"));
      await expect(simulateWebhookInsert("evt_abc123")).rejects.toThrow("Connection lost");
    });
  });

  describe("random generateEventId still works", () => {
    it("produces unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateEventId()));
      expect(ids.size).toBe(100);
    });

    it("has evt_ prefix", () => {
      expect(generateEventId()).toMatch(/^evt_/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// P1b: Webhook retry CAS lock
// ═════════════════════════════════════════════════════════════════════

describe("P1b: webhook retry CAS lock", () => {
  const mockFindPendingRetries = vi.fn();
  const mockClaimForRetry = vi.fn();
  const enqueued: Array<{ deliveryId: number; endpointId: number }> = [];

  async function simulateRetryJob() {
    const pending = await mockFindPendingRetries(new Date());
    let claimed = 0;
    for (const delivery of pending) {
      const won = await mockClaimForRetry(delivery.id);
      if (!won) continue;
      claimed++;
      enqueued.push({ deliveryId: delivery.id, endpointId: delivery.endpointId });
    }
    return claimed;
  }

  beforeEach(() => {
    mockFindPendingRetries.mockReset();
    mockClaimForRetry.mockReset();
    enqueued.length = 0;
  });

  it("claims and enqueues a pending delivery", async () => {
    mockFindPendingRetries.mockResolvedValue([{ id: 10, endpointId: 5 }]);
    mockClaimForRetry.mockResolvedValue(true);

    const claimed = await simulateRetryJob();
    expect(claimed).toBe(1);
    expect(enqueued).toEqual([{ deliveryId: 10, endpointId: 5 }]);
  });

  it("skips delivery when CAS claim fails (another instance won)", async () => {
    mockFindPendingRetries.mockResolvedValue([{ id: 10, endpointId: 5 }]);
    mockClaimForRetry.mockResolvedValue(false); // another instance claimed it

    const claimed = await simulateRetryJob();
    expect(claimed).toBe(0);
    expect(enqueued).toEqual([]);
  });

  it("handles mixed: 3 pending, 1 claimed by us, 2 already claimed", async () => {
    mockFindPendingRetries.mockResolvedValue([
      { id: 1, endpointId: 10 },
      { id: 2, endpointId: 20 },
      { id: 3, endpointId: 30 },
    ]);
    mockClaimForRetry.mockResolvedValueOnce(false); // id=1: lost
    mockClaimForRetry.mockResolvedValueOnce(true); // id=2: won
    mockClaimForRetry.mockResolvedValueOnce(false); // id=3: lost

    const claimed = await simulateRetryJob();
    expect(claimed).toBe(1);
    expect(enqueued).toEqual([{ deliveryId: 2, endpointId: 20 }]);
  });

  it("no pending deliveries → no claims attempted", async () => {
    mockFindPendingRetries.mockResolvedValue([]);
    const claimed = await simulateRetryJob();
    expect(claimed).toBe(0);
    expect(mockClaimForRetry).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════
// P2: Idempotency-Key middleware
// ═════════════════════════════════════════════════════════════════════

describe("P2: idempotency-key middleware", () => {
  // We test the middleware by mounting it on a real Hono app.
  // The middleware is imported fresh to use a clean CacheStore per test suite.

  let callCount: number;

  function createTestApp() {
    const app = new Hono();

    // Simulate auth middleware setting admin session
    app.use("/*", async (c, next) => {
      c.set("admin" as never, { adminId: 99 } as never);
      await next();
    });

    // Lazy import to avoid hoisting issues with cache store
    app.use("/*", async (c, next) => {
      const { idempotencyGuard } = await import("@/server/middleware/idempotency");
      return idempotencyGuard()(c, next);
    });

    app.post("/resources", (c) => {
      callCount++;
      return c.json({ id: callCount, name: "test-resource" }, 201);
    });

    app.get("/resources", (c) => {
      callCount++;
      return c.json([]);
    });

    return app;
  }

  beforeEach(() => {
    callCount = 0;
  });

  it("no Idempotency-Key header → handler executes normally", async () => {
    const app = createTestApp();
    const res = await app.request("/resources", { method: "POST" });
    expect(res.status).toBe(201);
    expect(callCount).toBe(1);
  });

  it("with Idempotency-Key: first call executes, second returns cached", async () => {
    const app = createTestApp();
    const headers = { "Idempotency-Key": "create-res-001" };

    const res1 = await app.request("/resources", { method: "POST", headers });
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1).toEqual({ id: 1, name: "test-resource" });
    expect(callCount).toBe(1);

    // Second call with same key
    const res2 = await app.request("/resources", { method: "POST", headers });
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2).toEqual({ id: 1, name: "test-resource" }); // same cached body
    expect(callCount).toBe(1); // handler NOT called again
  });

  it("different Idempotency-Key → handler executes again", async () => {
    const app = createTestApp();

    await app.request("/resources", {
      method: "POST",
      headers: { "Idempotency-Key": "key-a" },
    });
    expect(callCount).toBe(1);

    await app.request("/resources", {
      method: "POST",
      headers: { "Idempotency-Key": "key-b" },
    });
    expect(callCount).toBe(2); // different key, new execution
  });

  it("GET requests bypass idempotency guard", async () => {
    const app = createTestApp();
    const headers = { "Idempotency-Key": "get-test" };

    await app.request("/resources", { method: "GET", headers });
    await app.request("/resources", { method: "GET", headers });
    expect(callCount).toBe(2); // GET always executes
  });

  it("Idempotency-Key over 256 chars → 400 error", async () => {
    const app = createTestApp();
    const res = await app.request("/resources", {
      method: "POST",
      headers: { "Idempotency-Key": "x".repeat(257) },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("too long");
    expect(callCount).toBe(0);
  });

  it("keys are scoped per adminId (no cross-admin collision)", async () => {
    // We need two apps with different adminIds
    const app1 = new Hono();
    app1.use("/*", async (c, next) => {
      c.set("admin" as never, { adminId: 1 } as never);
      await next();
    });
    app1.use("/*", async (c, next) => {
      const { idempotencyGuard } = await import("@/server/middleware/idempotency");
      return idempotencyGuard()(c, next);
    });
    app1.post("/resources", (c) => {
      callCount++;
      return c.json({ admin: 1, count: callCount }, 201);
    });

    const app2 = new Hono();
    app2.use("/*", async (c, next) => {
      c.set("admin" as never, { adminId: 2 } as never);
      await next();
    });
    app2.use("/*", async (c, next) => {
      const { idempotencyGuard } = await import("@/server/middleware/idempotency");
      return idempotencyGuard()(c, next);
    });
    app2.post("/resources", (c) => {
      callCount++;
      return c.json({ admin: 2, count: callCount }, 201);
    });

    const key = "same-key-both-merchants";
    const res1 = await app1.request("/resources", {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });
    const res2 = await app2.request("/resources", {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });

    expect(callCount).toBe(2); // both executed (different admins)
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.admin).toBe(1);
    expect(body2.admin).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// P3: Notification dedupeKey
// ═════════════════════════════════════════════════════════════════════

describe("P3: notification dedupeKey", () => {
  function buildDedupeKey(event: string, configId: number, timestampMs: number): string {
    const tsSecond = Math.floor(timestampMs / 1000);
    const input = `${event}:${configId}:${tsSecond}`;
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  }

  describe("dedupeKey determinism", () => {
    it("same inputs → same key", () => {
      const k1 = buildDedupeKey("tx.settled", 5, 1700000000_000);
      const k2 = buildDedupeKey("tx.settled", 5, 1700000000_000);
      expect(k1).toBe(k2);
    });

    it("same second, different ms → same key (second-level granularity)", () => {
      const k1 = buildDedupeKey("tx.settled", 5, 1700000000_100);
      const k2 = buildDedupeKey("tx.settled", 5, 1700000000_900);
      expect(k1).toBe(k2);
    });

    it("different second → different key", () => {
      const k1 = buildDedupeKey("tx.settled", 5, 1700000000_000);
      const k2 = buildDedupeKey("tx.settled", 5, 1700001000_000);
      expect(k1).not.toBe(k2);
    });

    it("different event → different key", () => {
      const k1 = buildDedupeKey("tx.settled", 5, 1700000000_000);
      const k2 = buildDedupeKey("alert.circuit-breaker", 5, 1700000000_000);
      expect(k1).not.toBe(k2);
    });

    it("different configId → different key", () => {
      const k1 = buildDedupeKey("tx.settled", 1, 1700000000_000);
      const k2 = buildDedupeKey("tx.settled", 2, 1700000000_000);
      expect(k1).not.toBe(k2);
    });

    it("key is 32 hex characters", () => {
      const k = buildDedupeKey("tx.settled", 1, Date.now());
      expect(k).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe("dispatcher UNIQUE catch pattern", () => {
    const mockInsert = vi.fn();

    async function simulateNotificationInsert(dedupeKey: string) {
      try {
        const result = await mockInsert({ dedupeKey, event: "tx.settled", status: "pending" });
        return { status: "inserted", logEntry: result };
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          return { status: "skipped" };
        }
        throw err;
      }
    }

    beforeEach(() => mockInsert.mockReset());

    it("first notification insert succeeds", async () => {
      mockInsert.mockResolvedValue({ id: 1 });
      const result = await simulateNotificationInsert("abc123");
      expect(result.status).toBe("inserted");
    });

    it("duplicate notification (UNIQUE violation) is caught and skipped", async () => {
      mockInsert.mockRejectedValueOnce(
        new Error("UNIQUE constraint failed: notification_logs.dedupe_key"),
      );
      const result = await simulateNotificationInsert("abc123");
      expect(result.status).toBe("skipped");
    });

    it("non-UNIQUE errors propagate", async () => {
      mockInsert.mockRejectedValueOnce(new Error("Disk full"));
      await expect(simulateNotificationInsert("abc123")).rejects.toThrow("Disk full");
    });

    it("two notifications same second → same dedupeKey → second is caught", async () => {
      const ts = 1700000000_500;
      const key1 = buildDedupeKey("tx.settled", 5, ts);
      const key2 = buildDedupeKey("tx.settled", 5, ts + 200); // 200ms later, same second

      expect(key1).toBe(key2); // proves they'd collide

      mockInsert.mockResolvedValueOnce({ id: 1 });
      mockInsert.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));

      const r1 = await simulateNotificationInsert(key1);
      const r2 = await simulateNotificationInsert(key2);
      expect(r1.status).toBe("inserted");
      expect(r2.status).toBe("skipped");
    });
  });
});
