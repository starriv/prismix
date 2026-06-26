import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/metrics", () => ({
  aiUpstreamConcurrencyActive: { set: vi.fn() },
  aiUpstreamConcurrencyWaiting: { set: vi.fn() },
  aiUpstreamConcurrencyAcquireTotal: { inc: vi.fn() },
  aiUpstreamConcurrencyTimeoutTotal: { inc: vi.fn() },
  aiUpstreamConcurrencyWaitDuration: { observe: vi.fn() },
}));

const { redisState, redisEval } = vi.hoisted(() => {
  const redisState = {
    active: new Map<string, Map<string, number>>(),
    waiting: new Map<string, Map<string, number>>(),
  };

  function getMap(root: Map<string, Map<string, number>>, key: string): Map<string, number> {
    let map = root.get(key);
    if (!map) {
      map = new Map();
      root.set(key, map);
    }
    return map;
  }

  function sortedFirst(map: Map<string, number>): string | undefined {
    return [...map.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
  }

  const redisEval = vi.fn(async (script: string, _keyCount: number, ...args: unknown[]) => {
    const [activeKey, waitingKey] = args as string[];
    const active = getMap(redisState.active, activeKey);
    const waiting = getMap(redisState.waiting, waitingKey);

    if (script.includes('ZREM", KEYS[1]')) {
      const token = args[2] as string;
      active.delete(token);
      waiting.delete(token);
      return [active.size, waiting.size];
    }

    const now = Number(args[2]);
    const activeTtlMs = Number(args[3]);
    const limit = Number(args[4]);
    const token = args[5] as string;
    const waitingStaleBefore = Number(args[6]);
    const shouldEnqueue = args[7] === "1";

    for (const [member, expiresAt] of active) {
      if (expiresAt <= now) active.delete(member);
    }
    for (const [member, queuedAt] of waiting) {
      if (queuedAt <= waitingStaleBefore) waiting.delete(member);
    }

    if (active.size < limit && waiting.size === 0) {
      active.set(token, now + activeTtlMs);
      return [1, active.size, 0, 0];
    }

    if (shouldEnqueue) waiting.set(token, now);

    if (active.size < limit && sortedFirst(waiting) === token) {
      waiting.delete(token);
      active.set(token, now + activeTtlMs);
      return [1, active.size, waiting.size, 0];
    }

    const ordered = [...waiting.entries()].sort((a, b) => a[1] - b[1]).map(([member]) => member);
    const rank = ordered.indexOf(token);
    return [0, active.size, waiting.size, rank >= 0 ? rank + 1 : 0];
  });

  return { redisState, redisEval };
});

vi.mock("@/server/lib/redis", () => ({
  getRedis: () => ({ eval: redisEval }),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe("upstream concurrency", () => {
  beforeEach(() => {
    redisState.active.clear();
    redisState.waiting.clear();
    redisEval.mockClear();
  });

  it("skips Redis when upstream has no configured limit", async () => {
    const { acquireUpstreamSlot } = await import("@/server/ai/lib/upstream-concurrency");

    await expect(
      acquireUpstreamSlot({ upstreamId: 1, concurrencyLimit: null }),
    ).resolves.toBeNull();
    expect(redisEval).not.toHaveBeenCalled();
  });

  it("acquires and releases an immediate slot", async () => {
    const { acquireUpstreamSlot, releaseUpstreamSlot } =
      await import("@/server/ai/lib/upstream-concurrency");

    const lease = await acquireUpstreamSlot({ upstreamId: 1, concurrencyLimit: 1 });
    expect(lease).toMatchObject({ upstreamId: 1, limit: 1, waitedMs: expect.any(Number) });
    expect(redisState.active.get("ai:upstream-concurrency:1:active")?.size).toBe(1);

    await releaseUpstreamSlot(lease);
    expect(redisState.active.get("ai:upstream-concurrency:1:active")?.size).toBe(0);
  });

  it("supports provider official upstream scope keys", async () => {
    const { acquireUpstreamSlot, releaseUpstreamSlot } =
      await import("@/server/ai/lib/upstream-concurrency");

    const lease = await acquireUpstreamSlot({
      upstreamId: null,
      concurrencyScopeKey: "provider:7:official",
      concurrencyLimit: 1,
    });

    expect(lease).toMatchObject({
      upstreamId: null,
      scopeKey: "provider:7:official",
      limit: 1,
    });
    expect(redisState.active.get("ai:upstream-concurrency:provider:7:official:active")?.size).toBe(
      1,
    );

    await releaseUpstreamSlot(lease);
    expect(redisState.active.get("ai:upstream-concurrency:provider:7:official:active")?.size).toBe(
      0,
    );
  });

  it("waits until an existing slot is released", async () => {
    const { acquireUpstreamSlot, releaseUpstreamSlot } =
      await import("@/server/ai/lib/upstream-concurrency");

    const first = await acquireUpstreamSlot({ upstreamId: 2, concurrencyLimit: 1 });
    const secondPromise = acquireUpstreamSlot({
      upstreamId: 2,
      concurrencyLimit: 1,
      queueTimeoutMs: 500,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await releaseUpstreamSlot(first);

    const second = await secondPromise;
    expect(second?.upstreamId).toBe(2);
    expect(second?.waitedMs).toBeGreaterThan(0);
    await releaseUpstreamSlot(second);
  });

  it("times out and removes the waiting token", async () => {
    const { acquireUpstreamSlot, releaseUpstreamSlot, UpstreamConcurrencyTimeoutError } =
      await import("@/server/ai/lib/upstream-concurrency");

    const first = await acquireUpstreamSlot({ upstreamId: 3, concurrencyLimit: 1 });

    await expect(
      acquireUpstreamSlot({ upstreamId: 3, concurrencyLimit: 1, queueTimeoutMs: 10 }),
    ).rejects.toBeInstanceOf(UpstreamConcurrencyTimeoutError);

    expect(redisState.waiting.get("ai:upstream-concurrency:3:waiting")?.size ?? 0).toBe(0);
    await releaseUpstreamSlot(first);
  });

  it("serves waiting tokens in FIFO order", async () => {
    const { acquireUpstreamSlot, releaseUpstreamSlot } =
      await import("@/server/ai/lib/upstream-concurrency");

    const first = await acquireUpstreamSlot({ upstreamId: 4, concurrencyLimit: 1 });
    const order: number[] = [];

    const secondPromise = acquireUpstreamSlot({
      upstreamId: 4,
      concurrencyLimit: 1,
      queueTimeoutMs: 500,
    }).then((l) => {
      order.push(2);
      return l;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const thirdPromise = acquireUpstreamSlot({
      upstreamId: 4,
      concurrencyLimit: 1,
      queueTimeoutMs: 500,
    }).then((l) => {
      order.push(3);
      return l;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await releaseUpstreamSlot(first);

    const second = await secondPromise;
    await releaseUpstreamSlot(second);

    const third = await thirdPromise;
    await releaseUpstreamSlot(third);

    expect(order).toEqual([2, 3]);
  });
});

describe("toConcurrencyLastError", () => {
  it("maps UpstreamConcurrencyTimeoutError to 429", async () => {
    const { toConcurrencyLastError, UpstreamConcurrencyTimeoutError } =
      await import("@/server/ai/lib/upstream-concurrency");

    const err = new UpstreamConcurrencyTimeoutError("provider:1:official", null, 30_000);
    expect(toConcurrencyLastError(err)).toMatchObject({ status: 429 });
  });

  it("maps unexpected errors to 503", async () => {
    const { toConcurrencyLastError } = await import("@/server/ai/lib/upstream-concurrency");

    expect(toConcurrencyLastError(new Error("Redis down"))).toMatchObject({ status: 503 });
    expect(toConcurrencyLastError("unknown")).toMatchObject({ status: 503 });
  });
});
