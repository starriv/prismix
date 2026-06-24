import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindAllConfigs = vi.fn();
const mockFindConfigById = vi.fn();
const mockCreateConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockDeleteConfig = vi.fn();
const mockInsertLog = vi.fn();
const mockUpdateLogStatus = vi.fn();

vi.mock("@/server/repos", () => ({
  notificationConfigRepo: {
    findAll: (...args: unknown[]) => mockFindAllConfigs(...args),
    findById: (...args: unknown[]) => mockFindConfigById(...args),
    create: (...args: unknown[]) => mockCreateConfig(...args),
    update: (...args: unknown[]) => mockUpdateConfig(...args),
    delete: (...args: unknown[]) => mockDeleteConfig(...args),
  },
  notificationLogRepo: {
    insert: (...args: unknown[]) => mockInsertLog(...args),
    updateStatus: (...args: unknown[]) => mockUpdateLogStatus(...args),
  },
}));

vi.mock("@/server/lib/notification-provider-config", () => ({
  getNotificationProviderConfigCached: () => ({
    email: { enabled: true },
    telegram: { enabled: false },
    webhook: { enabled: true },
    whatsapp: { enabled: true },
  }),
  getChannelConfig: () => ({}),
  isChannelEnabled: (channel: string) => channel === "email" || channel === "webhook",
  saveNotificationProviderConfig: vi.fn(),
}));

vi.mock("@/server/lib/auth-provider-config", () => ({
  getAuthProviderConfigCached: () => ({}),
  saveAuthProviderConfig: vi.fn(),
}));

vi.mock("@/server/lib/gateway-config", () => ({
  getGatewayConfigCached: () => ({}),
  initGatewayConfig: vi.fn(),
  resolveTimeoutConfig: vi.fn((config) => config),
  saveGatewayConfigSection: vi.fn(),
}));

vi.mock("@/server/lib/write-queue", () => ({
  getWriteQueueStats: () => ({}),
}));

vi.mock("@/server/middleware/rate-limiter", () => ({
  getRateLimiterStats: () => ({}),
}));

vi.mock("@/server/lib/crypto", () => ({
  encrypt: (value: string, tag: string) => `enc:${tag}:${value}`,
  decrypt: (value: string) => value.replace(/^enc:[^:]+:/, ""),
}));

const { default: router } = await import("@/server/admin/routes/admin-config");

function createApp() {
  const app = new Hono();
  app.route("/", router);
  return app;
}

describe("admin notification config routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAllConfigs.mockResolvedValue([]);
    mockFindConfigById.mockResolvedValue(undefined);
    mockCreateConfig.mockImplementation(async (data) => ({
      id: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...data,
    }));
    mockUpdateConfig.mockImplementation(async (id, data) => ({
      id,
      channel: "webhook",
      label: "Ops",
      target: "https://hooks.example.com/ops",
      secret: null,
      events: '["system.announcement"]',
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...data,
    }));
    mockDeleteConfig.mockResolvedValue(undefined);
    mockInsertLog.mockResolvedValue({ id: 9 });
    mockUpdateLogStatus.mockResolvedValue(undefined);
  });

  it("returns event groups and only enabled registered channels", async () => {
    const res = await createApp().request("/notification-events");
    const json = (await res.json()) as {
      data: {
        groups: Array<{
          key: string;
          labelKey: string;
          events: Array<{ type: string; labelKey: string; descriptionKey: string }>;
        }>;
        enabledChannels: string[];
      };
    };

    expect(res.status).toBe(200);
    expect(json.data.enabledChannels).toEqual(["email", "webhook"]);
    expect(json.data.groups.map((group) => group.key)).toEqual([
      "topup",
      "tx",
      "alert",
      "supplier",
      "system",
    ]);
    expect(json.data.groups[0]).toMatchObject({
      key: "topup",
      labelKey: "notif.group.topup",
    });
    expect(json.data.groups.flatMap((group) => group.events.map((event) => event.type))).toContain(
      "topup.expired",
    );
    expect(json.data.groups[0]?.events[0]).toMatchObject({
      type: "topup.requested",
      labelKey: "notif.event.topup-requested",
      descriptionKey: "notif.event-desc.topup-requested",
    });
  });

  it("serializes stored events and masks secrets when listing configs", async () => {
    mockFindAllConfigs.mockResolvedValue([
      {
        id: 3,
        channel: "webhook",
        label: "Ops",
        target: "https://hooks.example.com/ops",
        secret: "encrypted-secret",
        events: '["alert.error-spike","system.announcement"]',
        enabled: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await createApp().request("/notification-configs");
    const json = (await res.json()) as { data: Array<{ secret: string; events: string[] }> };

    expect(res.status).toBe(200);
    expect(json.data[0]).toMatchObject({
      secret: "****",
      events: ["alert.error-spike", "system.announcement"],
    });
  });

  it("creates a config with JSON-encoded events and encrypted webhook secret", async () => {
    const res = await createApp().request("/notification-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "webhook",
        label: "Ops",
        target: "https://hooks.example.com/ops",
        secret: "whsec_test",
        events: ["system.announcement"],
        enabled: true,
      }),
    });
    const json = (await res.json()) as { data: { channel: string; secret: string | null } };

    expect(res.status).toBe(201);
    expect(mockCreateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webhook",
        secret: "enc:notification-provider-config:whsec_test",
        events: '["system.announcement"]',
      }),
    );
    expect(json.data.channel).toBe("webhook");
    expect(json.data.secret).toBe("****");
  });

  it("rejects disabled or unregistered channels", async () => {
    const res = await createApp().request("/notification-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "whatsapp",
        label: "WhatsApp",
        target: "+1234567890",
        events: ["system.announcement"],
        enabled: true,
      }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateConfig).not.toHaveBeenCalled();
  });

  it("validates target format before creating configs", async () => {
    const res = await createApp().request("/notification-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "email",
        label: "Ops",
        target: "not-an-email",
        events: ["system.announcement"],
        enabled: true,
      }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateConfig).not.toHaveBeenCalled();
  });
});
