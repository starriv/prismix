/**
 * EventBus scope + RedisEventBus unit tests.
 *
 * Tests ConsumerScope filtering (local vs broadcast) and RedisEventBus
 * with fully mocked ioredis — no live Redis needed.
 */
import { EventEmitter } from "events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEvent } from "@/server/events/event-bus";
import { RedisEventBus } from "@/server/events/redis-event-bus";

const mockRedis = () =>
  ({
    duplicate: () => ({
      subscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    }),
    publish: vi.fn().mockResolvedValue(1),
  }) as never;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

// Helper to access private dispatch method for testing
function dispatchOnBus(
  bus: RedisEventBus,
  ...args: Parameters<RedisEventBus["emit"]> extends [infer E] ? [E, string] : never
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bus as any).dispatch(...args);
}

// ─────────────────────────────────────────────────────────────────────
// 1. RedisEventBus — scope filtering
// ─────────────────────────────────────────────────────────────────────

describe("RedisEventBus — ConsumerScope filtering", () => {
  let bus: RedisEventBus;

  beforeEach(() => {
    bus = new RedisEventBus(mockRedis());
  });

  afterEach(async () => {
    await bus.close();
  });

  it("emit() runs both local and broadcast handlers (no filter)", async () => {
    const local = vi.fn();
    const broadcast = vi.fn();
    bus.on("tx.settled", local, "local");
    bus.on("tx.settled", broadcast, "broadcast");

    bus.emit(createEvent("tx.settled", "user:42"));
    await flush();

    expect(local).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("dispatch(event, 'broadcast') runs ONLY broadcast handlers", async () => {
    const local = vi.fn();
    const broadcast = vi.fn();
    bus.on("tx.settled", local, "local");
    bus.on("tx.settled", broadcast, "broadcast");

    dispatchOnBus(bus, createEvent("tx.settled", "user:42"), "broadcast");
    await flush();

    expect(local).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("dispatch(event, 'local') runs ONLY local handlers", async () => {
    const local = vi.fn();
    const broadcast = vi.fn();
    bus.on("tx.settled", local, "local");
    bus.on("tx.settled", broadcast, "broadcast");

    dispatchOnBus(bus, createEvent("tx.settled", "user:42"), "local");
    await flush();

    expect(local).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("scope filtering works with wildcard patterns", async () => {
    const localCatchAll = vi.fn();
    const broadcastCatchAll = vi.fn();
    bus.on("*", localCatchAll, "local");
    bus.on("*", broadcastCatchAll, "broadcast");

    dispatchOnBus(bus, createEvent("tx.settled", "user:42"), "broadcast");
    await flush();

    expect(localCatchAll).not.toHaveBeenCalled();
    expect(broadcastCatchAll).toHaveBeenCalledTimes(1);
  });

  it("default scope is 'local'", async () => {
    const handler = vi.fn();
    bus.on("tx.settled", handler); // no scope arg → defaults to "local"

    dispatchOnBus(bus, createEvent("tx.settled", "user:42"), "broadcast");
    await flush();

    expect(handler).not.toHaveBeenCalled(); // not broadcast scope
  });

  it("mixed scopes on different patterns work correctly", async () => {
    const notifLocal = vi.fn();
    const sseBroadcast = vi.fn();
    const auditLocal = vi.fn();

    bus.on("tx.settled", notifLocal, "local");
    bus.on("*", sseBroadcast, "broadcast");
    bus.on("tx.*", auditLocal, "local");

    // Simulate Redis subscriber dispatch (broadcast only)
    dispatchOnBus(bus, createEvent("tx.settled", "user:42"), "broadcast");
    await flush();

    expect(sseBroadcast).toHaveBeenCalledTimes(1);
    expect(notifLocal).not.toHaveBeenCalled();
    expect(auditLocal).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RedisEventBus — with mocked ioredis
// ─────────────────────────────────────────────────────────────────────

describe("RedisEventBus — mocked Redis", () => {
  let redisMock: MockRedis;
  let subscriberMock: MockRedis;

  /** Minimal ioredis mock that extends EventEmitter for .on("message") */
  class MockRedis extends EventEmitter {
    subscribe = vi.fn((_ch: string, cb: (err: Error | null) => void) => cb(null));
    unsubscribe = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(1);
    quit = vi.fn().mockResolvedValue("OK");
    duplicate = vi.fn(() => subscriberMock);
  }

  beforeEach(() => {
    subscriberMock = new MockRedis();
    redisMock = new MockRedis();
    redisMock.duplicate = vi.fn(() => subscriberMock);
  });

  async function createBus() {
    const { RedisEventBus } = await import("@/server/events/redis-event-bus");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new RedisEventBus(redisMock as any);
  }

  it("constructor subscribes to prismix:events channel", async () => {
    const bus = await createBus();
    expect(subscriberMock.subscribe).toHaveBeenCalledWith("prismix:events", expect.any(Function));
    await bus.close();
  });

  it("emit() runs ALL local handlers + publishes to Redis", async () => {
    const bus = await createBus();
    const local = vi.fn();
    const broadcast = vi.fn();

    bus.on("tx.settled", local, "local");
    bus.on("tx.settled", broadcast, "broadcast");

    const event = createEvent("tx.settled", "user:42", { amount: "10" });
    bus.emit(event);
    await flush();

    // Both handlers ran locally
    expect(local).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);

    // Published to Redis
    expect(redisMock.publish).toHaveBeenCalledTimes(1);
    expect(redisMock.publish).toHaveBeenCalledWith("prismix:events", JSON.stringify(event));

    await bus.close();
  });

  it("Redis message triggers ONLY broadcast handlers (simulating other instance)", async () => {
    const bus = await createBus();
    const local = vi.fn();
    const broadcast = vi.fn();

    bus.on("tx.settled", local, "local");
    bus.on("*", broadcast, "broadcast");

    // Simulate receiving a message from Redis (another instance published it)
    const event = createEvent("tx.settled", "user:99", { amount: "50" });
    subscriberMock.emit("message", "prismix:events", JSON.stringify(event));
    await flush();

    // Only broadcast handler ran — local handler did NOT
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tx.settled", scope: "user:99" }),
    );
    expect(local).not.toHaveBeenCalled();

    await bus.close();
  });

  it("malformed Redis message does not crash the bus", async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on("*", handler, "broadcast");

    // Send garbage
    subscriberMock.emit("message", "prismix:events", "not-valid-json{{{");
    await flush();

    expect(handler).not.toHaveBeenCalled(); // No crash, just skipped

    await bus.close();
  });

  it("close() unsubscribes and quits subscriber connection", async () => {
    const bus = await createBus();

    await bus.close();

    expect(subscriberMock.unsubscribe).toHaveBeenCalledWith("prismix:events");
    expect(subscriberMock.quit).toHaveBeenCalled();
  });

  it("messages after close() are ignored", async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on("*", handler, "broadcast");

    await bus.close();

    subscriberMock.emit(
      "message",
      "prismix:events",
      JSON.stringify(createEvent("tx.settled", "user:1")),
    );
    await flush();

    expect(handler).not.toHaveBeenCalled();
  });

  it("publish failure is logged, not thrown", async () => {
    const bus = await createBus();
    redisMock.publish.mockRejectedValueOnce(new Error("Redis down"));

    // Should NOT throw
    bus.emit(createEvent("tx.settled", "user:1"));
    await flush();

    expect(redisMock.publish).toHaveBeenCalled();
    await bus.close();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. End-to-end scope scenario: notification (local) vs SSE (broadcast)
// ─────────────────────────────────────────────────────────────────────

describe("scope scenario — notification vs SSE", () => {
  it("emitting instance: both notification + SSE fire", async () => {
    const bus = new RedisEventBus(mockRedis());
    const notification = vi.fn();
    const sse = vi.fn();

    bus.on("tx.settled", notification, "local");
    bus.on("*", sse, "broadcast");

    // This instance emits → emit() runs all handlers (no scope filter)
    bus.emit(createEvent("tx.settled", "user:42"));
    await flush();

    expect(notification).toHaveBeenCalledTimes(1);
    expect(sse).toHaveBeenCalledTimes(1);

    await bus.close();
  });

  it("receiving instance (Redis message): only SSE fires, NOT notification", async () => {
    const bus = new RedisEventBus(mockRedis());
    const notification = vi.fn();
    const sse = vi.fn();

    bus.on("tx.settled", notification, "local");
    bus.on("*", sse, "broadcast");

    // Simulate what RedisEventBus does when receiving from another instance
    dispatchOnBus(bus, createEvent("tx.settled", "user:42"), "broadcast");
    await flush();

    expect(sse).toHaveBeenCalledTimes(1);
    expect(notification).not.toHaveBeenCalled(); // No duplicate notification!

    await bus.close();
  });

  it("proves notification executes exactly once across 2 simulated instances", async () => {
    // Instance A (emitter)
    const busA = new RedisEventBus(mockRedis());
    const notifA = vi.fn();
    const sseA = vi.fn();
    busA.on("tx.settled", notifA, "local");
    busA.on("*", sseA, "broadcast");

    // Instance B (receiver via Redis)
    const busB = new RedisEventBus(mockRedis());
    const notifB = vi.fn();
    const sseB = vi.fn();
    busB.on("tx.settled", notifB, "local");
    busB.on("*", sseB, "broadcast");

    const event = createEvent("tx.settled", "user:42", { amount: "$100" });

    // Instance A emits locally (all handlers)
    busA.emit(event);
    // Instance B receives via Redis (broadcast only)
    dispatchOnBus(busB, event, "broadcast");

    await flush();

    // Notification: exactly 1 total (only on A)
    expect(notifA).toHaveBeenCalledTimes(1);
    expect(notifB).not.toHaveBeenCalled();

    // SSE: 2 total (one per instance — both browsers get the update)
    expect(sseA).toHaveBeenCalledTimes(1);
    expect(sseB).toHaveBeenCalledTimes(1);

    await busA.close();
    await busB.close();
  });
});
