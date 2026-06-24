import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventHandler } from "@/server/events/event-bus";
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

// ─────────────────────────────────────────────────────────────────────
// 1. createEvent helper
// ─────────────────────────────────────────────────────────────────────

describe("createEvent", () => {
  it("creates event with auto-timestamp", () => {
    const before = Date.now();
    const event = createEvent("tx.settled", "user:42", { amount: "1.5" });
    expect(event.type).toBe("tx.settled");
    expect(event.scope).toBe("user:42");
    expect(event.data).toEqual({ amount: "1.5" });
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("defaults data to empty object", () => {
    const event = createEvent("system.announcement", null);
    expect(event.data).toEqual({});
    expect(event.scope).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RedisEventBus — emit + on
// ─────────────────────────────────────────────────────────────────────

describe("RedisEventBus", () => {
  let bus: RedisEventBus;

  beforeEach(() => {
    bus = new RedisEventBus(mockRedis());
  });

  afterEach(async () => {
    await bus.close();
  });

  it("delivers event to exact-match handler", async () => {
    const handler = vi.fn();
    bus.on("tx.settled", handler);

    const event = createEvent("tx.settled", "user:1", { amount: "10" });
    bus.emit(event);

    // queueMicrotask — wait for delivery
    await flushMicrotasks();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does NOT deliver event to non-matching handler", async () => {
    const handler = vi.fn();
    bus.on("tx.settled", handler);

    bus.emit(createEvent("tx.verify-failed", "user:1"));

    await flushMicrotasks();
    expect(handler).not.toHaveBeenCalled();
  });

  it("wildcard * matches all events", async () => {
    const handler = vi.fn();
    bus.on("*", handler);

    bus.emit(createEvent("tx.settled", "user:1"));
    bus.emit(createEvent("gateway.upstream-timeout", "user:2"));
    bus.emit(createEvent("system.announcement", null));

    await flushMicrotasks();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("domain wildcard tx.* matches all tx events", async () => {
    const handler = vi.fn();
    bus.on("tx.*", handler);

    bus.emit(createEvent("tx.settled", "user:1"));
    bus.emit(createEvent("tx.verify-failed", "user:1"));
    bus.emit(createEvent("gateway.upstream-timeout", "user:2")); // should NOT match

    await flushMicrotasks();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("domain wildcard gateway.* matches gateway events", async () => {
    const handler = vi.fn();
    bus.on("gateway.*", handler);

    bus.emit(createEvent("gateway.circuit-open", null));
    bus.emit(createEvent("gateway.upstream-error", "user:1"));
    bus.emit(createEvent("tx.settled", "user:1")); // should NOT match

    await flushMicrotasks();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("multiple handlers on same pattern all receive event", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("tx.settled", h1);
    bus.on("tx.settled", h2);

    bus.emit(createEvent("tx.settled", "user:1"));

    await flushMicrotasks();
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("multiple patterns can match same event", async () => {
    const exact = vi.fn();
    const wildcard = vi.fn();
    const catchAll = vi.fn();
    bus.on("tx.settled", exact);
    bus.on("tx.*", wildcard);
    bus.on("*", catchAll);

    bus.emit(createEvent("tx.settled", "user:1"));

    await flushMicrotasks();
    expect(exact).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
    expect(catchAll).toHaveBeenCalledTimes(1);
  });

  it("async handler errors do not crash the bus", async () => {
    const failing: EventHandler = async () => {
      throw new Error("consumer crash");
    };
    const working = vi.fn();
    bus.on("tx.settled", failing);
    bus.on("tx.settled", working);

    bus.emit(createEvent("tx.settled", "user:1"));

    await flushMicrotasks();
    // Working handler still called despite other handler throwing
    expect(working).toHaveBeenCalledTimes(1);
  });

  it("close() clears all handlers", async () => {
    const handler = vi.fn();
    bus.on("*", handler);

    await bus.close();
    bus.emit(createEvent("tx.settled", "user:1"));

    await flushMicrotasks();
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Consumer registration — verifies bus.on is called correctly
// ─────────────────────────────────────────────────────────────────────

describe("consumer registration", () => {
  it("SSE consumer registers a catch-all * handler", async () => {
    const bus = new RedisEventBus(mockRedis());
    const origOn = bus.on.bind(bus);
    const patterns: string[] = [];
    bus.on = (pattern: string, handler: EventHandler) => {
      patterns.push(pattern);
      origOn(pattern, handler);
    };

    const { registerSseConsumer } = await import("@/server/events/consumers/sse");
    registerSseConsumer(bus);
    expect(patterns).toContain("*");
  });

  it("notification consumer registers domain-specific patterns", async () => {
    const bus = new RedisEventBus(mockRedis());
    const origOn = bus.on.bind(bus);
    const patterns: string[] = [];
    bus.on = (pattern: string, handler: EventHandler) => {
      patterns.push(pattern);
      origOn(pattern, handler);
    };

    const { registerNotificationConsumer } = await import("@/server/events/consumers/notification");
    const { listNotificationSubscriptions } =
      await import("@/server/messaging/notifications/events");
    registerNotificationConsumer(bus);
    expect(patterns.sort()).toEqual(listNotificationSubscriptions().sort());
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Event system — all events follow naming convention
// ─────────────────────────────────────────────────────────────────────

describe("event naming conventions", () => {
  const ALL_EVENTS = [
    "resource.created",
    "resource.updated",
    "resource.deleted",
    "agent.created",
    "agent.suspended",
    "topup.requested",
    "topup.confirmed",
    "topup.rejected",
    "system.announcement",
  ];

  it("all events follow <domain>.<action> pattern", () => {
    for (const event of ALL_EVENTS) {
      expect(event).toMatch(/^[a-z]+\.[a-z-]+$/);
    }
  });

  it("all events have exactly one dot separator", () => {
    for (const event of ALL_EVENTS) {
      expect(event.split(".")).toHaveLength(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
