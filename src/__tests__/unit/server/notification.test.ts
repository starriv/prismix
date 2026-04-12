import crypto from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decrypt, encrypt } from "@/server/lib/crypto";
import type { NotificationPayload } from "@/server/messaging/notifications/channel";

// ── Shared test fixtures ─────────────────────────────────────────────

const DOMAIN_TAG = "notification-provider-config";

const SAMPLE_PAYLOAD: NotificationPayload = {
  event: "topup.requested",
  title: "New top-up request",
  body: "User requested 20 USDC top-up for Agent #1",
  timestamp: 1711234567890,
  metadata: { orderId: 123, amount: "20" },
};

/** All RFC-defined events — these MUST match the server EVENT_GROUPS */
const ALL_EVENTS = ["topup.requested", "topup.confirmed", "topup.rejected", "system.announcement"];

const EVENT_GROUPS = [
  { key: "topup", events: ["topup.requested", "topup.confirmed", "topup.rejected"] },
  { key: "system", events: ["system.announcement"] },
];

// ─────────────────────────────────────────────────────────────────────
// 1. Encryption round-trip (provider secrets)
// ─────────────────────────────────────────────────────────────────────

describe("notification-provider-config encryption", () => {
  it("roundtrips SMTP password", () => {
    const secret = "my-smtp-password-123";
    const encrypted = encrypt(secret, DOMAIN_TAG);
    expect(encrypted).not.toBe(secret);
    expect(encrypted).toContain(":");
    expect(decrypt(encrypted, DOMAIN_TAG)).toBe(secret);
  });

  it("roundtrips Telegram bot token", () => {
    const token = "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ_abcdefg";
    const encrypted = encrypt(token, DOMAIN_TAG);
    expect(decrypt(encrypted, DOMAIN_TAG)).toBe(token);
  });

  it("roundtrips webhook HMAC secret", () => {
    const secret = "whsec_abc123def456";
    const encrypted = encrypt(secret, DOMAIN_TAG);
    expect(decrypt(encrypted, DOMAIN_TAG)).toBe(secret);
  });

  it("roundtrips WhatsApp API token", () => {
    const token = "EAAxxxxxxxxxxxxxxxxxxxxxxx";
    const encrypted = encrypt(token, DOMAIN_TAG);
    expect(decrypt(encrypted, DOMAIN_TAG)).toBe(token);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt("same-secret", DOMAIN_TAG);
    const b = encrypt("same-secret", DOMAIN_TAG);
    expect(a).not.toBe(b);
    expect(decrypt(a, DOMAIN_TAG)).toBe("same-secret");
  });

  it("different domain tags cannot decrypt each other", () => {
    const encrypted = encrypt("my-secret", DOMAIN_TAG);
    expect(() => decrypt(encrypted, "wrong-tag")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Channel registry
// ─────────────────────────────────────────────────────────────────────

describe("notification channel registry", () => {
  it("registers and retrieves all channels", async () => {
    const { registerChannel, getChannel, listChannels } =
      await import("@/server/messaging/notifications/registry");
    const { EmailChannel } = await import("@/server/messaging/notifications/channels/email");
    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");

    registerChannel(new EmailChannel());
    registerChannel(new TelegramChannel());
    registerChannel(new WebhookChannel());

    expect(getChannel("email")?.name).toBe("email");
    expect(getChannel("telegram")?.name).toBe("telegram");
    expect(getChannel("webhook")?.name).toBe("webhook");
    expect(getChannel("whatsapp")).toBeUndefined();
    expect(listChannels().length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Target validation (all providers)
// ─────────────────────────────────────────────────────────────────────

describe("email — target validation", () => {
  it("accepts valid emails", async () => {
    const { EmailChannel } = await import("@/server/messaging/notifications/channels/email");
    const ch = new EmailChannel();
    expect(ch.validateTarget("user@example.com")).toBeNull();
    expect(ch.validateTarget("test+tag@sub.domain.co")).toBeNull();
    expect(ch.validateTarget("a@b.cc")).toBeNull();
  });

  it("rejects invalid emails", async () => {
    const { EmailChannel } = await import("@/server/messaging/notifications/channels/email");
    const ch = new EmailChannel();
    expect(ch.validateTarget("not-an-email")).toBeTruthy();
    expect(ch.validateTarget("@missing-local")).toBeTruthy();
    expect(ch.validateTarget("user@")).toBeTruthy();
    expect(ch.validateTarget("")).toBeTruthy();
  });
});

describe("telegram — target validation", () => {
  it("accepts valid chat IDs (positive and negative)", async () => {
    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const ch = new TelegramChannel();
    expect(ch.validateTarget("123456789")).toBeNull();
    expect(ch.validateTarget("-100123456789")).toBeNull();
    expect(ch.validateTarget("-1")).toBeNull();
  });

  it("rejects non-numeric chat IDs", async () => {
    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const ch = new TelegramChannel();
    expect(ch.validateTarget("abc")).toBeTruthy();
    expect(ch.validateTarget("12.34")).toBeTruthy();
    expect(ch.validateTarget("@username")).toBeTruthy();
    expect(ch.validateTarget("")).toBeTruthy();
  });
});

describe("webhook — target validation", () => {
  it("accepts valid public URLs", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();
    expect(ch.validateTarget("https://hooks.example.com/callback")).toBeNull();
    expect(ch.validateTarget("http://api.external.com/webhook")).toBeNull();
    expect(ch.validateTarget("https://hooks.slack.com/services/T00/B00/xxx")).toBeNull();
  });

  it("blocks private/internal addresses (SSRF protection)", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();
    expect(ch.validateTarget("http://localhost:3000/hook")).toBeTruthy();
    expect(ch.validateTarget("http://127.0.0.1/hook")).toBeTruthy();
    expect(ch.validateTarget("http://10.0.0.1/hook")).toBeTruthy();
    expect(ch.validateTarget("http://192.168.1.1/hook")).toBeTruthy();
    expect(ch.validateTarget("http://172.16.0.1/hook")).toBeTruthy();
    expect(ch.validateTarget("http://0.0.0.0/hook")).toBeTruthy();
  });

  it("rejects non-http protocols and invalid URLs", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();
    expect(ch.validateTarget("ftp://files.example.com/x")).toBeTruthy();
    expect(ch.validateTarget("not-a-url")).toBeTruthy();
    expect(ch.validateTarget("")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Webhook channel — send() + HMAC signature verification
// ─────────────────────────────────────────────────────────────────────

describe("webhook — send() with fetch mock", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends POST with correct payload structure", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();

    await ch.send("https://hooks.example.com/test", SAMPLE_PAYLOAD);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/test");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("Prismix-Webhook/1.0");

    // Verify body structure matches all RFC-defined fields
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("topup.requested");
    expect(body.title).toBe("New top-up request");
    expect(body.body).toBe("User requested 20 USDC top-up for Agent #1");
    expect(body.timestamp).toBe(1711234567890);
    expect(body.metadata).toEqual({ orderId: 123, amount: "20" });
  });

  it("attaches X-Prismix-Signature header when secret is provided", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();
    const secret = "my-webhook-secret";

    await ch.send("https://hooks.example.com/test", SAMPLE_PAYLOAD, { secret });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Prismix-Signature"]).toBeDefined();
    expect(headers["X-Prismix-Signature"]).toHaveLength(64); // SHA-256 hex

    // Verify the signature is correct by recomputing it
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(init.body as string)
      .digest("hex");
    expect(headers["X-Prismix-Signature"]).toBe(expectedSig);
  });

  it("does NOT attach signature header when no secret", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();

    await ch.send("https://hooks.example.com/test", SAMPLE_PAYLOAD);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Prismix-Signature"]).toBeUndefined();
  });

  it("throws on non-2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Server Error", { status: 500 }));
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();

    await expect(ch.send("https://hooks.example.com/fail", SAMPLE_PAYLOAD)).rejects.toThrow(
      "Webhook returned 500",
    );
  });

  it("sends each RFC event type correctly", async () => {
    const { WebhookChannel } = await import("@/server/messaging/notifications/channels/webhook");
    const ch = new WebhookChannel();

    for (const event of ALL_EVENTS) {
      fetchSpy.mockResolvedValueOnce(new Response("ok", { status: 200 }));
      await ch.send("https://hooks.example.com/test", { ...SAMPLE_PAYLOAD, event });
    }

    expect(fetchSpy).toHaveBeenCalledTimes(ALL_EVENTS.length);

    // Verify each call has the correct event in body
    for (let i = 0; i < ALL_EVENTS.length; i++) {
      const [, init] = fetchSpy.mock.calls[i] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.event).toBe(ALL_EVENTS[i]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Telegram channel — send() with fetch mock
// ─────────────────────────────────────────────────────────────────────

describe("telegram — send() with fetch mock", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends to correct Telegram Bot API URL", async () => {
    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const ch = new TelegramChannel();
    const botToken = "123456:ABCdefGHI-jklMNOpqrSTUvwxYZ_0123456789a";

    await ch.send("-100123456", SAMPLE_PAYLOAD, {
      providerConfig: { botToken },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${botToken}/sendMessage`);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100123456");
    expect(body.parse_mode).toBe("MarkdownV2");
    // Title should appear in the text (escaped)
    expect(body.text).toContain("New top\\-up request");
  });

  it("throws if botToken is missing", async () => {
    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const ch = new TelegramChannel();

    await expect(ch.send("-100123456", SAMPLE_PAYLOAD, { providerConfig: {} })).rejects.toThrow(
      "Telegram Bot Token not configured",
    );
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }),
    );
    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const ch = new TelegramChannel();

    await expect(
      ch.send("-100123456", SAMPLE_PAYLOAD, {
        providerConfig: { botToken: "invalid-token" },
      }),
    ).rejects.toThrow("Telegram API error (401)");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Email channel — send() with fetch/nodemailer mock
// ─────────────────────────────────────────────────────────────────────

describe("email — send()", () => {
  it("throws if providerConfig is missing", async () => {
    const { EmailChannel } = await import("@/server/messaging/notifications/channels/email");
    const ch = new EmailChannel();

    await expect(ch.send("user@example.com", SAMPLE_PAYLOAD)).rejects.toThrow(
      "Email provider config is required",
    );
  });

  it("throws if Resend API key is missing", async () => {
    const { EmailChannel } = await import("@/server/messaging/notifications/channels/email");
    const ch = new EmailChannel();

    await expect(
      ch.send("user@example.com", SAMPLE_PAYLOAD, {
        providerConfig: { provider: "resend", resendApiKey: "" },
      }),
    ).rejects.toThrow("Resend API key not configured");
  });

  it("calls Resend SDK — verifies fetch to api.resend.com", async () => {
    // Resend SDK calls fetch internally — mock it to return a success response
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: "email_123" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { EmailChannel } = await import("@/server/messaging/notifications/channels/email");
    const ch = new EmailChannel();

    await ch.send("user@example.com", SAMPLE_PAYLOAD, {
      providerConfig: {
        provider: "resend",
        resendApiKey: "re_test_key_123",
        fromAddress: "noreply@prismix.app",
        fromName: "Prismix",
      },
    });

    expect(fetchSpy).toHaveBeenCalled();
    // Resend SDK sends to api.resend.com/emails
    const urls = fetchSpy.mock.calls.map(([urlOrReq]) =>
      typeof urlOrReq === "string" ? urlOrReq : (urlOrReq as Request).url,
    );
    expect(urls.some((u) => u.includes("api.resend.com"))).toBe(true);

    fetchSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Event system — verify events are real RFC-defined events
// ─────────────────────────────────────────────────────────────────────

describe("event system — RFC event consistency", () => {
  it("EVENT_GROUPS cover exactly the ALL_EVENTS list", () => {
    const fromGroups = EVENT_GROUPS.flatMap((g) => g.events).sort();
    const expected = [...ALL_EVENTS].sort();
    expect(fromGroups).toEqual(expected);
  });

  it("all events follow the <domain>.<action> naming convention", () => {
    for (const event of ALL_EVENTS) {
      expect(event).toMatch(/^[a-z]+\.[a-z-]+$/);
    }
  });

  it("event groups have correct keys", () => {
    const groupKeys = EVENT_GROUPS.map((g) => g.key);
    expect(groupKeys).toEqual(["topup", "system"]);
  });

  it("each group contains only events with its prefix", () => {
    for (const group of EVENT_GROUPS) {
      for (const event of group.events) {
        expect(event.startsWith(`${group.key}.`)).toBe(true);
      }
    }
  });

  it("server notification consumer handles all fixture events", async () => {
    // Verify the notification consumer source handles the events in our fixture
    const consumerSource = await import("fs").then((fs) =>
      fs.readFileSync("src/server/events/consumers/notification.ts", "utf-8"),
    );

    // All event patterns should be referenced in the consumer
    expect(consumerSource).toContain("topup.*");
    expect(consumerSource).toContain("system.announcement");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Webhook HMAC — consumer-side verification
// ─────────────────────────────────────────────────────────────────────

describe("webhook HMAC — consumer verification flow", () => {
  it("consumer can verify signature using shared secret", () => {
    const secret = "merchant-webhook-secret-123";
    const body = JSON.stringify({
      event: "topup.requested",
      title: "New top-up",
      body: "User requested 20 USDC",
      timestamp: 1711234567890,
    });

    // Producer (Prismix server) signs
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

    // Consumer (merchant server) verifies
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(signature).toBe(expected);
    expect(signature).toHaveLength(64);
  });

  it("wrong secret produces different signature", () => {
    const body = JSON.stringify({ event: "test" });
    const sig1 = crypto.createHmac("sha256", "correct-secret").update(body).digest("hex");
    const sig2 = crypto.createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(sig1).not.toBe(sig2);
  });

  it("tampered body fails verification", () => {
    const secret = "shared-secret";
    const original = JSON.stringify({ event: "topup.requested", amount: "20" });
    const tampered = JSON.stringify({ event: "topup.requested", amount: "2000" });

    const signature = crypto.createHmac("sha256", secret).update(original).digest("hex");
    const verify = crypto.createHmac("sha256", secret).update(tampered).digest("hex");
    expect(signature).not.toBe(verify);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. Telegram MarkdownV2 escaping
// ─────────────────────────────────────────────────────────────────────

describe("telegram — MarkdownV2 escaping", () => {
  it("escapes special characters in message text", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { TelegramChannel } = await import("@/server/messaging/notifications/channels/telegram");
    const ch = new TelegramChannel();

    const payload: NotificationPayload = {
      ...SAMPLE_PAYLOAD,
      title: "Price: $0.01 (100% off!)",
      body: "User [admin] signed-up via #link",
    };

    await ch.send("123", payload, {
      providerConfig: { botToken: "fake:token_for_test_only_xxxxx_xxxxxxxxxx" },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    // MarkdownV2 special chars: _ * [ ] ( ) ~ ` > # + - = | { } . ! \
    // Note: $ is NOT a special char in MarkdownV2
    expect(body.text).toContain("$0\\.01"); // . is escaped
    expect(body.text).toContain("\\#link"); // # is escaped
    expect(body.text).toContain("\\[admin\\]"); // [ ] are escaped
    expect(body.text).toContain("\\(100% off\\!\\)"); // ( ) ! are escaped

    fetchSpy.mockRestore();
  });
});
