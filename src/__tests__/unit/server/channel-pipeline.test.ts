/**
 * Per-channel full pipeline tests — every provider from domain event to HTTP delivery.
 *
 * Tests the complete chain for EACH channel:
 *   EventBus emit() → NotificationConsumer → dispatcher → channel.send() → HTTP
 *
 * Mocks: repos (DB), write-queue (sync), notification-provider-config (dynamic per-test).
 * Real: RedisEventBus, NotificationConsumer, dispatcher, all channel implementations, fetch.
 */
import crypto from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Imports (after mocks) ───────────────────────────────────────────

import { registerNotificationConsumer } from "@/server/events/consumers/notification";
import { createEvent } from "@/server/events/event-bus";
import { RedisEventBus } from "@/server/events/redis-event-bus";
import { EmailChannel } from "@/server/messaging/notifications/channels/email";
import { TelegramChannel } from "@/server/messaging/notifications/channels/telegram";
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

// ── Dynamic channel enable control ──────────────────────────────────

let _enabledChannel = "webhook";
let _channelConfig: Record<string, unknown> = {};

// ── Mocks ───────────────────────────────────────────────────────────

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

vi.mock("@/server/lib/notification-provider-config", () => ({
  isChannelEnabled: (channel: string) => channel === _enabledChannel,
  getChannelConfig: () => _channelConfig,
  listEnabledChannels: () => [_enabledChannel],
  getNotificationProviderConfigCached: () => ({ [_enabledChannel]: { enabled: true } }),
  initNotificationProviderConfig: vi.fn(),
  saveNotificationProviderConfig: vi.fn(),
  invalidateNotificationProviderConfig: vi.fn(),
}));

// Register all channels
registerChannel(new EmailChannel());
registerChannel(new TelegramChannel());
registerChannel(new WebhookChannel());
initNotificationQueue();

function resetMocks() {
  mockFindByEvent.mockReset();
  mockInsertLog.mockReset();
  mockUpdateLogStatus.mockReset();
  mockInsertLog.mockResolvedValue({ id: 900 });
  mockUpdateLogStatus.mockResolvedValue(undefined);
}

// ─────────────────────────────────────────────────────────────────────
// 1. EMAIL — SMTP pipeline
// ─────────────────────────────────────────────────────────────────────

describe("email (SMTP) pipeline: emit → dispatcher → SMTP sendMail", () => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });

  beforeEach(() => {
    _enabledChannel = "email";
    _channelConfig = {
      provider: "smtp",
      smtpHost: "smtp.test.com",
      smtpPort: 587,
      smtpUser: "user@test.com",
      smtpPass: "password123",
      fromAddress: "noreply@test.com",
      fromName: "Prismix",
    };
    resetMocks();
    mockSendMail.mockClear();

    // Mock nodemailer
    vi.doMock("nodemailer", () => ({
      createTransport: () => ({ sendMail: mockSendMail }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("nodemailer");
  });

  it("dispatcher sends email via SMTP when config exists", async () => {
    mockFindByEvent.mockResolvedValue([
      {
        id: 301,
        channel: "email",
        target: "ops@merchant.com",
        secret: null,
        events: '["system.announcement"]',
        enabled: true,
      },
    ]);

    await emitNotification("system.announcement", {
      title: "Scheduled Maintenance",
      body: "System will be down at 3am UTC for upgrades.",
    });

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailOpts = mockSendMail.mock.calls[0][0];
    expect(mailOpts.to).toBe("ops@merchant.com");
    expect(mailOpts.subject).toContain("system.announcement");
    expect(mailOpts.subject).toContain("Scheduled Maintenance");
    expect(mailOpts.text).toContain("upgrades");
    expect(mailOpts.from).toContain("noreply@test.com");

    // Log lifecycle
    expect(mockInsertLog).toHaveBeenCalledTimes(1);
    expect(mockInsertLog.mock.calls[0][0]).toMatchObject({
      channel: "email",
      target: "ops@merchant.com",
      status: "pending",
    });
    expect(mockUpdateLogStatus).toHaveBeenCalledWith(
      900,
      "sent",
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it("full pipeline: emit('system.announcement') → email delivery", async () => {
    const bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);

    mockFindByEvent.mockResolvedValue([
      {
        id: 302,
        channel: "email",
        target: "ceo@merchant.com",
        secret: null,
        events: '["system.announcement"]',
        enabled: true,
      },
    ]);

    bus.emit(
      createEvent("system.announcement", null, { title: "Maintenance", body: "Planned downtime" }),
    );

    await new Promise((r) => setTimeout(r, 300));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailOpts = mockSendMail.mock.calls[0][0];
    expect(mailOpts.to).toBe("ceo@merchant.com");
    expect(mailOpts.subject).toContain("system.announcement");

    await bus.close();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. EMAIL — Resend API pipeline
// ─────────────────────────────────────────────────────────────────────

describe("email (Resend) pipeline: emit → dispatcher → Resend SDK", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _enabledChannel = "email";
    _channelConfig = {
      provider: "resend",
      resendApiKey: "re_test_key_abc123",
      fromAddress: "noreply@prismix.app",
      fromName: "Prismix",
    };
    resetMocks();
    // Resend SDK uses fetch internally — mock it to return success
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "email_123" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("dispatcher sends email via Resend SDK (fetch called to api.resend.com)", async () => {
    mockFindByEvent.mockResolvedValue([
      {
        id: 401,
        channel: "email",
        target: "admin@merchant.com",
        secret: null,
        events: '["tx.large-amount"]',
        enabled: true,
      },
    ]);

    await emitNotification("tx.large-amount", {
      title: "Large payment: $500 USDC",
      body: "Resource /api/premium received $500 from 0x1234",
    });

    await new Promise((r) => setTimeout(r, 100));

    // Resend SDK calls fetch internally — verify it was called to the Resend API
    expect(fetchSpy).toHaveBeenCalled();
    const urls = fetchSpy.mock.calls.map(([urlOrReq]: [unknown]) =>
      typeof urlOrReq === "string" ? urlOrReq : (urlOrReq as Request).url,
    );
    expect(urls.some((u: string) => u.includes("api.resend.com"))).toBe(true);

    // Log written
    expect(mockInsertLog.mock.calls[0][0]).toMatchObject({
      channel: "email",
      target: "admin@merchant.com",
    });
  });

  it("full pipeline: emit('topup.confirmed') → Resend SDK email delivery", async () => {
    const bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);

    mockFindByEvent.mockResolvedValue([
      {
        id: 402,
        channel: "email",
        target: "finance@merchant.com",
        secret: null,
        events: '["topup.confirmed"]',
        enabled: true,
      },
    ]);

    bus.emit(
      createEvent("topup.confirmed", "user:42", {
        orderId: 456,
        amount: "100",
      }),
    );

    await new Promise((r) => setTimeout(r, 300));

    expect(fetchSpy).toHaveBeenCalled();
    const urls = fetchSpy.mock.calls.map(([urlOrReq]: [unknown]) =>
      typeof urlOrReq === "string" ? urlOrReq : (urlOrReq as Request).url,
    );
    expect(urls.some((u: string) => u.includes("api.resend.com"))).toBe(true);

    await bus.close();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. TELEGRAM pipeline
// ─────────────────────────────────────────────────────────────────────

describe("telegram pipeline: emit → dispatcher → Telegram Bot API", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const BOT_TOKEN = "9876543210:ABCdefGHIjklMNOpqrSTUvwxYZ_testonly";

  beforeEach(() => {
    _enabledChannel = "telegram";
    _channelConfig = { botToken: BOT_TOKEN };
    resetMocks();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("dispatcher sends Telegram message via Bot API", async () => {
    mockFindByEvent.mockResolvedValue([
      {
        id: 501,
        channel: "telegram",
        target: "-100987654321",
        secret: null,
        events: '["system.announcement"]',
        enabled: true,
      },
    ]);

    await emitNotification("system.announcement", {
      title: "System maintenance scheduled",
      body: "System will be down for maintenance at 3am UTC.",
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100987654321");
    expect(body.parse_mode).toBe("MarkdownV2");
    expect(body.text).toContain("System maintenance");
    expect(body.text).toContain("system\\.announcement"); // event name escaped

    // Log lifecycle
    expect(mockInsertLog.mock.calls[0][0]).toMatchObject({
      channel: "telegram",
      target: "-100987654321",
    });
    expect(mockUpdateLogStatus).toHaveBeenCalledWith(
      900,
      "sent",
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it("uses provider chatId for supplier health notifications without explicit configs", async () => {
    _channelConfig = { botToken: BOT_TOKEN, chatId: "-100333444555" };
    mockFindByEvent.mockResolvedValue([]);

    await emitNotification("supplier.disabled", {
      title: "供应商已自动禁用: Proxy A",
      body: `上游 "Proxy A" 连续 1 次连通性检查失败，已自动禁用。最后错误: HTTP 503: upstream-timeout

详细信息:
  类型: 上游
  ID: 10
  名称: Proxy A
  Base URL: https://proxy-a.example.com/v1
  所属供应商: OpenAI
  Provider ID: 1
  连续失败: 3
  最后错误: HTTP 503: upstream-timeout`,
      metadata: {
        kind: "upstream",
        id: 10,
        name: "Proxy A",
        baseUrl: "https://proxy-a.example.com/v1",
        providerId: 1,
        providerName: "OpenAI",
        consecutiveFailures: 3,
        error: "HTTP 503: upstream-timeout",
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100333444555");
    expect(body.text).toContain("supplier\\.disabled");
    expect(body.text).toContain("详细信息");
    expect(body.text).toContain("类型: 上游");
    expect(body.text).toContain("ID: 10");
    expect(body.text).toContain("名称: Proxy A");
    expect(body.text).toContain("Base URL: https://proxy\\-a\\.example\\.com/v1");
    expect(body.text).toContain("所属供应商: OpenAI");
    expect(body.text).toContain("Provider ID: 1");
    expect(body.text).toContain("连续失败: 3");
    expect(body.text).toContain("最后错误: HTTP 503: upstream\\-timeout");

    expect(mockInsertLog.mock.calls[0][0]).toMatchObject({
      configId: null,
      channel: "telegram",
      event: "supplier.disabled",
      target: "-100333444555",
    });
  });

  it("full pipeline: emit('system.announcement') → Telegram message", async () => {
    const bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);

    mockFindByEvent.mockResolvedValue([
      {
        id: 502,
        channel: "telegram",
        target: "-100111222333",
        secret: null,
        events: '["system.announcement"]',
        enabled: true,
      },
    ]);

    bus.emit(
      createEvent("system.announcement", null, {
        title: "System maintenance scheduled",
        body: "Planned downtime at 3am UTC.",
      }),
    );

    await new Promise((r) => setTimeout(r, 300));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100111222333");
    expect(body.text).toContain("System maintenance");

    await bus.close();
  });

  it("full pipeline: emit('topup.requested') → Telegram message (passthrough)", async () => {
    const bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);

    mockFindByEvent.mockResolvedValue([
      {
        id: 503,
        channel: "telegram",
        target: "-100444555666",
        secret: null,
        events: '["topup.requested"]',
        enabled: true,
      },
    ]);

    bus.emit(createEvent("topup.requested", "user:42", { orderId: 777, amount: "50" }));

    await new Promise((r) => setTimeout(r, 300));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sendMessage");

    await bus.close();
  });

  it("Telegram API error triggers retry then failure", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, description: "Forbidden" }), { status: 403 }),
      ),
    );

    mockFindByEvent.mockResolvedValue([
      {
        id: 504,
        channel: "telegram",
        target: "-100777888999",
        secret: null,
        events: '["system.announcement"]',
        enabled: true,
      },
    ]);

    await emitNotification("system.announcement", {
      title: "Maintenance notice",
      body: "System going down",
    });

    // Wait for 3 retries (1s + 2s + execution)
    await new Promise((r) => setTimeout(r, 8000));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(mockUpdateLogStatus).toHaveBeenLastCalledWith(
      900,
      "failed",
      expect.objectContaining({
        lastError: expect.stringContaining("403"),
        attempts: 3,
      }),
    );
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────
// 4. WEBHOOK pipeline (verify it still works with dynamic config)
// ─────────────────────────────────────────────────────────────────────

describe("webhook pipeline: emit → dispatcher → HTTP POST + HMAC", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _enabledChannel = "webhook";
    _channelConfig = {};
    resetMocks();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("full pipeline: emit('topup.requested') → webhook POST with HMAC", async () => {
    const bus = new RedisEventBus(mockRedis());
    registerNotificationConsumer(bus);

    const secret = "webhook-hmac-secret";
    mockFindByEvent.mockResolvedValue([
      {
        id: 601,
        channel: "webhook",
        target: "https://hooks.merchant.com/topup",
        secret,
        events: '["topup.requested"]',
        enabled: true,
      },
    ]);

    bus.emit(createEvent("topup.requested", "user:42", { orderId: 999, amount: "50" }));

    await new Promise((r) => setTimeout(r, 300));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.merchant.com/topup");

    // Verify HMAC
    const headers = init.headers as Record<string, string>;
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(init.body as string)
      .digest("hex");
    expect(headers["X-Prismix-Signature"]).toBe(expectedSig);

    // Verify passthrough event
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("topup.requested");

    await bus.close();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Cross-channel: same event, multiple channels
// ─────────────────────────────────────────────────────────────────────

describe("multi-channel dispatch — same event to different channels", () => {
  it("multiple webhook configs both receive the notification", async () => {
    // Enable ALL channels
    _enabledChannel = "webhook";

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    resetMocks();

    mockFindByEvent.mockResolvedValue([
      {
        id: 701,
        channel: "webhook",
        target: "https://hooks.merchant.com/ops",
        secret: null,
        events: '["tx.large-amount"]',
        enabled: true,
      },
      {
        id: 702,
        channel: "webhook",
        target: "https://hooks.merchant.com/finance",
        secret: "finance-secret",
        events: '["tx.large-amount"]',
        enabled: true,
      },
    ]);

    await emitNotification("tx.large-amount", {
      title: "Large payment",
      body: "$1000 received",
    });

    await new Promise((r) => setTimeout(r, 200));

    // Both webhook targets should be called
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const urls = fetchSpy.mock.calls.map(([url]) => url);
    expect(urls).toContain("https://hooks.merchant.com/ops");
    expect(urls).toContain("https://hooks.merchant.com/finance");

    // Second one should have HMAC signature
    const financeCall = fetchSpy.mock.calls.find(
      ([u]) => u === "https://hooks.merchant.com/finance",
    );
    const financeHeaders = (financeCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(financeHeaders["X-Prismix-Signature"]).toBeDefined();

    // First one should NOT have HMAC
    const opsCall = fetchSpy.mock.calls.find(([u]) => u === "https://hooks.merchant.com/ops");
    const opsHeaders = (opsCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(opsHeaders["X-Prismix-Signature"]).toBeUndefined();

    // Two log entries created
    expect(mockInsertLog).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
  });
});
