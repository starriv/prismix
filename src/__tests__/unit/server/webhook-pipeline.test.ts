/**
 * Webhook end-to-end pipeline tests.
 *
 * Verifies the FULL chain from domain event → EventBus → NotificationConsumer
 * → dispatcher → DB lookup → WebhookChannel.send() → HTTP POST with HMAC.
 *
 * Mocks: repos (DB), notification-provider-config (global config), write-queue (sync execution).
 * Real: RedisEventBus, NotificationConsumer, dispatcher logic, WebhookChannel, fetch.
 */
import crypto from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerNotificationConsumer } from "@/server/events/consumers/notification";
// Now import real modules (they'll get mocked deps injected)
import { createEvent } from "@/server/events/event-bus";
import { RedisEventBus } from "@/server/events/redis-event-bus";
import { WebhookChannel } from "@/server/messaging/notifications/channels/webhook";
import {
  emitNotification,
  initNotificationQueue,
} from "@/server/messaging/notifications/dispatcher";
import { registerChannel } from "@/server/messaging/notifications/registry";

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

// ── Mock setup (must be before imports) ─────────────────────────────

// Mock repos
const mockFindByEvent = vi.fn();
const mockInsertLog = vi.fn();
const mockUpdateLogStatus = vi.fn();

vi.mock("@/server/repos", () => ({
  notificationConfigRepo: {
    findByEvent: (...args: unknown[]) => mockFindByEvent(...args),
  },
  notificationLogRepo: {
    insert: (...args: unknown[]) => mockInsertLog(...args),
    updateStatus: (...args: unknown[]) => mockUpdateLogStatus(...args),
  },
}));

// Mock write-queue: execute job handlers inline (synchronous for tests)
const _jobHandlers = new Map<string, (data: Record<string, unknown>) => Promise<void>>();
vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (name: string, data: Record<string, unknown>) => {
    const handler = _jobHandlers.get(name);
    if (handler) handler(data);
  },
  registerWriteHandler: (
    name: string,
    handler: (data: Record<string, unknown>) => Promise<void>,
  ) => {
    _jobHandlers.set(name, handler);
  },
  initWriteQueue: vi.fn(),
}));

// Mock notification-provider-config
vi.mock("@/server/lib/notification-provider-config", () => ({
  isChannelEnabled: (channel: string) => channel === "webhook",
  getChannelConfig: () => ({}),
  listEnabledChannels: () => ["webhook"],
  getNotificationProviderConfigCached: () => ({ webhook: { enabled: true } }),
  initNotificationProviderConfig: vi.fn(),
  saveNotificationProviderConfig: vi.fn(),
  invalidateNotificationProviderConfig: vi.fn(),
}));

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// Ensure webhook channel is registered
registerChannel(new WebhookChannel());
initNotificationQueue();

// ─────────────────────────────────────────────────────────────────────
// 1. Dispatcher → WebhookChannel.send() — direct call
// ─────────────────────────────────────────────────────────────────────

describe("dispatcher → webhook delivery", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mockFindByEvent.mockReset();
    mockInsertLog.mockReset();
    mockUpdateLogStatus.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("emitNotification() finds webhook config, calls fetch with correct URL and payload", async () => {
    // Setup: webhook config subscribed to tx.large-amount
    mockFindByEvent.mockResolvedValue([
      {
        id: 101,
        channel: "webhook",
        target: "https://merchant.example.com/webhook",
        secret: null,
        events: '["tx.large-amount"]',
        enabled: true,
      },
    ]);
    mockInsertLog.mockResolvedValue({ id: 501 });
    mockUpdateLogStatus.mockResolvedValue(undefined);

    await emitNotification("tx.large-amount", {
      title: "Large payment: $100 USDC",
      body: "Resource /api/premium received payment",
      metadata: { amount: "$100", payer: "0x1234" },
    });

    await flushAsync();

    // Verify fetch was called
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://merchant.example.com/webhook");
    expect(init.method).toBe("POST");

    // Verify payload structure
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("tx.large-amount");
    expect(body.title).toBe("Large payment: $100 USDC");
    expect(body.body).toBe("Resource /api/premium received payment");
    expect(body.metadata).toEqual({ amount: "$100", payer: "0x1234" });
    expect(body.timestamp).toBeGreaterThan(0);

    // Verify headers
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("Prismix-Webhook/1.0");

    // Verify log was written as pending then updated to sent
    expect(mockInsertLog).toHaveBeenCalledTimes(1);
    expect(mockInsertLog.mock.calls[0][0]).toMatchObject({
      channel: "webhook",
      event: "tx.large-amount",
      target: "https://merchant.example.com/webhook",
      status: "pending",
    });
    expect(mockUpdateLogStatus).toHaveBeenCalledWith(
      501,
      "sent",
      expect.objectContaining({
        attempts: 1,
      }),
    );
  });

  it("webhook with HMAC secret attaches X-Prismix-Signature header", async () => {
    const webhookSecret = "merchant-shared-secret-123";

    mockFindByEvent.mockResolvedValue([
      {
        id: 102,
        channel: "webhook",
        target: "https://merchant.example.com/signed-webhook",
        secret: webhookSecret, // raw secret (dispatcher will try decrypt, fall back to raw)
        events: '["alert.circuit-breaker"]',
        enabled: true,
      },
    ]);
    mockInsertLog.mockResolvedValue({ id: 502 });
    mockUpdateLogStatus.mockResolvedValue(undefined);

    await emitNotification("alert.circuit-breaker", {
      title: "Circuit breaker opened",
      body: "Upstream-1 is down",
    });

    await flushAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    // Verify HMAC signature exists
    expect(headers["X-Prismix-Signature"]).toBeDefined();
    expect(headers["X-Prismix-Signature"]).toHaveLength(64);

    // Verify signature is correct (consumer-side verification)
    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(init.body as string)
      .digest("hex");
    expect(headers["X-Prismix-Signature"]).toBe(expectedSig);
  });

  it("skips delivery when no matching notification configs found", async () => {
    mockFindByEvent.mockResolvedValue([]);

    await emitNotification("tx.large-amount", {
      title: "Test",
      body: "Test",
    });

    await flushAsync();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockInsertLog).not.toHaveBeenCalled();
  });

  it("skips delivery when channel is not globally enabled", async () => {
    // Config has email channel, but we only enabled webhook in mock
    mockFindByEvent.mockResolvedValue([
      {
        id: 103,
        channel: "email", // NOT enabled in our mock
        target: "user@example.com",
        secret: null,
        events: '["tx.large-amount"]',
        enabled: true,
      },
    ]);
    mockInsertLog.mockResolvedValue({ id: 503 });

    await emitNotification("tx.large-amount", { title: "Test", body: "Test" });

    await flushAsync();

    // fetch should NOT be called (email channel not enabled)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks log as failed when webhook returns 500", async () => {
    fetchSpy.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    mockFindByEvent.mockResolvedValue([
      {
        id: 104,
        channel: "webhook",
        target: "https://failing.example.com/webhook",
        secret: null,
        events: '["tx.large-amount"]',
        enabled: true,
      },
    ]);
    mockInsertLog.mockResolvedValue({ id: 504 });
    mockUpdateLogStatus.mockResolvedValue(undefined);

    await emitNotification("tx.large-amount", { title: "Test", body: "Test" });

    // Wait for retry attempts (3 attempts with exponential backoff)
    // In tests the sleep still runs so we need to wait long enough
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // After 3 failed attempts, log should be marked as failed
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 3 retry attempts
    expect(mockUpdateLogStatus).toHaveBeenLastCalledWith(
      504,
      "failed",
      expect.objectContaining({
        lastError: expect.stringContaining("500"),
        attempts: 3,
      }),
    );
  }, 15_000); // Extended timeout for retry backoff
});

// ─────────────────────────────────────────────────────────────────────
// 2. Full pipeline: EventBus → NotificationConsumer → dispatcher → webhook
// ─────────────────────────────────────────────────────────────────────

describe("full pipeline: EventBus emit → webhook HTTP", () => {
  let bus: RedisEventBus;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);

    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mockFindByEvent.mockReset();
    mockInsertLog.mockReset();
    mockUpdateLogStatus.mockReset();
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await bus.close();
  });

  it("emit('topup.confirmed') → passthrough → dispatches to webhook", async () => {
    mockFindByEvent.mockResolvedValue([
      {
        id: 201,
        channel: "webhook",
        target: "https://hooks.merchant.com/topup",
        secret: null,
        events: '["topup.confirmed"]',
        enabled: true,
      },
    ]);
    mockInsertLog.mockResolvedValue({ id: 601 });
    mockUpdateLogStatus.mockResolvedValue(undefined);

    bus.emit(
      createEvent("topup.confirmed", "user:42", {
        orderId: 456,
        amount: "100",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify the webhook was actually called
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.merchant.com/topup");

    // Verify the notification event name is topup.confirmed (passthrough)
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("topup.confirmed");
    expect(body.title).toContain("confirmed");
  });

  it("emit('topup.requested') → passthrough → dispatches to webhook", async () => {
    mockFindByEvent.mockResolvedValue([
      {
        id: 203,
        channel: "webhook",
        target: "https://hooks.merchant.com/topup",
        secret: null,
        events: '["topup.requested"]',
        enabled: true,
      },
    ]);
    mockInsertLog.mockResolvedValue({ id: 603 });
    mockUpdateLogStatus.mockResolvedValue(undefined);

    bus.emit(createEvent("topup.requested", "user:42", { orderId: 999, amount: "50" }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("topup.requested");
  });

  it("events with no webhook config → no HTTP call", async () => {
    mockFindByEvent.mockResolvedValue([]); // no configs

    bus.emit(createEvent("topup.requested", "user:42", { orderId: 1, amount: "10" }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
