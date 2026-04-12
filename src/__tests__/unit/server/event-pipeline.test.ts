/**
 * Event pipeline integration tests — verifies the FULL emit → bus → consumer → side-effect chain.
 *
 * These tests wire up a real RedisEventBus with real consumers and verify
 * that domain events actually reach their intended targets (SSE listeners,
 * notification dispatcher).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerSseConsumer } from "@/server/events/consumers/sse";
import { createEvent } from "@/server/events/event-bus";
import { RedisEventBus } from "@/server/events/redis-event-bus";
import { subscribeToEvents } from "@/server/lib/sse";
import type { EventPayload } from "@/server/lib/sse";

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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

// ─────────────────────────────────────────────────────────────────────
// 1. SSE pipeline: emit() → EventBus → SseConsumer → SSE listener
// ─────────────────────────────────────────────────────────────────────

describe("SSE pipeline — emit → bus → SSE listener", () => {
  let bus: RedisEventBus;

  beforeEach(() => {
    bus = new RedisEventBus(mockRedis());
    registerSseConsumer(bus);
  });

  afterEach(async () => {
    await bus.close();
  });

  it("scoped event reaches SSE listener scoped to that scope", async () => {
    const received: EventPayload[] = [];
    const unsub = subscribeToEvents("user:42", (e) => received.push(e));

    bus.emit(createEvent("resource.created", "user:42", { resourceId: 1, path: "/api/test" }));
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("resource.created");
    expect(received[0].data).toEqual({ resourceId: 1, path: "/api/test" });

    unsub?.();
  });

  it("scoped event does NOT reach SSE listener scoped to different scope", async () => {
    const received: EventPayload[] = [];
    const unsub = subscribeToEvents("user:99", (e) => received.push(e));

    bus.emit(createEvent("resource.created", "user:42", { resourceId: 1 }));
    await flushMicrotasks();

    expect(received).toHaveLength(0);
    unsub?.();
  });

  it("admin listener (null scope) receives ALL scoped events", async () => {
    const received: EventPayload[] = [];
    const unsub = subscribeToEvents(null, (e) => received.push(e));

    bus.emit(createEvent("resource.created", "user:42", {}));
    bus.emit(createEvent("agent.created", "user:99", {}));
    bus.emit(createEvent("system.announcement", null, {}));
    await flushMicrotasks();

    expect(received).toHaveLength(3);
    expect(received.map((e) => e.type)).toEqual([
      "resource.created",
      "agent.created",
      "system.announcement",
    ]);

    unsub?.();
  });

  it("broadcast event (null scope) reaches all listeners", async () => {
    const scope42: EventPayload[] = [];
    const scope99: EventPayload[] = [];
    const admin: EventPayload[] = [];

    const u1 = subscribeToEvents("user:42", (e) => scope42.push(e));
    const u2 = subscribeToEvents("user:99", (e) => scope99.push(e));
    const u3 = subscribeToEvents(null, (e) => admin.push(e));

    bus.emit(createEvent("system.announcement", null, { title: "Maintenance" }));
    await flushMicrotasks();

    // Broadcast events go to ALL listeners
    expect(admin).toHaveLength(1);
    expect(admin[0].type).toBe("system.announcement");
    // Scoped listeners also receive broadcast (emitBroadcastEvent sends to all)
    expect(scope42).toHaveLength(1);
    expect(scope99).toHaveLength(1);

    u1?.();
    u2?.();
    u3?.();
  });

  it("topup.requested event carries topup data to SSE", async () => {
    const received: EventPayload[] = [];
    const unsub = subscribeToEvents("user:42", (e) => received.push(e));

    bus.emit(
      createEvent("topup.requested", "user:42", {
        orderId: 123,
        amount: "50",
      }),
    );
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("topup.requested");
    expect(received[0].data).toMatchObject({
      orderId: 123,
      amount: "50",
    });

    unsub?.();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Notification consumer — verify event → notification mapping
// ─────────────────────────────────────────────────────────────────────

describe("notification consumer — event mapping", () => {
  let bus: RedisEventBus;

  // Mock the notification dispatcher
  const mockEmitNotification = vi.fn();

  beforeEach(async () => {
    mockEmitNotification.mockReset();

    // Mock the notification module before importing the consumer
    vi.doMock("@/server/messaging/notifications/dispatcher", () => ({
      emitNotification: mockEmitNotification,
    }));

    // Fresh import with mocked dependency
    const { registerNotificationConsumer } = await import("@/server/events/consumers/notification");
    bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);
  });

  afterEach(async () => {
    vi.doUnmock("@/server/messaging/notifications/dispatcher");
    await bus.close();
  });

  it("topup.requested → emitNotification passthrough (same event name)", async () => {
    bus.emit(createEvent("topup.requested", "user:42", { orderId: 123, amount: "20" }));
    await flushMicrotasks();

    expect(mockEmitNotification).toHaveBeenCalledWith(
      "topup.requested",
      expect.objectContaining({
        title: expect.stringContaining("requested"),
      }),
    );
  });

  it("topup.confirmed → emitNotification passthrough", async () => {
    bus.emit(createEvent("topup.confirmed", "user:42", { orderId: 123 }));
    await flushMicrotasks();

    expect(mockEmitNotification).toHaveBeenCalledWith("topup.confirmed", expect.anything());
  });

  it("system.announcement → emitNotification (system.announcement)", async () => {
    bus.emit(
      createEvent("system.announcement", null, {
        title: "Maintenance",
        body: "System will be down at 3am",
      }),
    );
    await flushMicrotasks();

    expect(mockEmitNotification).toHaveBeenCalledTimes(1);
    expect(mockEmitNotification).toHaveBeenCalledWith(
      "system.announcement",
      expect.objectContaining({
        title: "Maintenance",
        body: "System will be down at 3am",
      }),
    );
  });

  it("unsubscribed events (resource.created, agent.created) do NOT trigger notifications", async () => {
    bus.emit(createEvent("resource.created", "user:42", { resourceId: 1 }));
    bus.emit(createEvent("agent.created", "user:42", { agentId: 1 }));
    await flushMicrotasks();

    expect(mockEmitNotification).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Multi-consumer fan-out — proves events reach all subscribers
// ─────────────────────────────────────────────────────────────────────

describe("multi-consumer fan-out", () => {
  it("same event reaches exact, wildcard, and catch-all handlers simultaneously", async () => {
    const bus = new RedisEventBus(mockRedis());
    const catchAll: EventPayload[] = [];
    const exactMatch: EventPayload[] = [];
    const wildcardMatch: EventPayload[] = [];

    // Simulate SSE consumer (catch-all)
    bus.on("*", (e) => {
      catchAll.push({ type: e.type, data: e.data });
    });
    // Simulate notification consumer (exact)
    bus.on("topup.requested", (e) => {
      exactMatch.push({ type: e.type, data: e.data });
    });
    // Simulate notification consumer (wildcard)
    bus.on("topup.*", (e) => {
      wildcardMatch.push({ type: e.type, data: e.data });
    });

    bus.emit(createEvent("topup.requested", "user:42", { orderId: 1, amount: "50" }));
    await flushMicrotasks();

    expect(catchAll).toHaveLength(1);
    expect(exactMatch).toHaveLength(1);
    expect(wildcardMatch).toHaveLength(1);

    await bus.close();
  });

  it("non-matching handlers are not triggered", async () => {
    const bus = new RedisEventBus(mockRedis());
    const resourceHandler: EventPayload[] = [];
    const sseHandler: EventPayload[] = [];

    bus.on("resource.*", (e) => {
      resourceHandler.push({ type: e.type, data: e.data });
    });
    bus.on("*", (e) => {
      sseHandler.push({ type: e.type, data: e.data });
    });

    bus.emit(createEvent("topup.requested", "user:42", {}));
    await flushMicrotasks();

    expect(resourceHandler).toHaveLength(0); // topup.requested does NOT match resource.*
    expect(sseHandler).toHaveLength(1); // * matches everything

    await bus.close();
  });
});
