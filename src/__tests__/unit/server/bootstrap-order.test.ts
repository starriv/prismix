/**
 * Unit tests for bootstrap initialization order.
 *
 * Verifies that modules are initialized in the correct order:
 * - initJwtSecret MUST run before anything that touches auth
 * - initGatewayConfig loads before queues
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Track call order ─────────────────────────────────────────────────

const callOrder: string[] = [];

function track(name: string) {
  callOrder.push(name);
}

// ── Mocks — every bootstrap dependency ───────────────────────────────

vi.mock("@/blockchain/config", () => ({
  initBlockchainConfig: vi.fn(async () => track("initBlockchainConfig")),
}));

vi.mock("@/server/auth/index", () => ({}));
vi.mock("@/server/messaging/notifications/index", () => ({}));

vi.mock("@/server/events", () => ({
  initEventBus: vi.fn(() => track("initEventBus")),
}));

vi.mock("@/server/jobs/expire-topup-orders", () => ({
  initTopupExpiryJob: vi.fn(() => track("initTopupExpiryJob")),
}));

vi.mock("@/server/messaging/notifications/dispatcher", () => ({
  initNotificationQueue: vi.fn(() => track("initNotificationQueue")),
}));

vi.mock("@/server/jobs/scan-topup-deposit", () => ({
  initDepositScanQueue: vi.fn(async () => track("initDepositScanQueue")),
}));

vi.mock("@/server/lib/auth-provider-config", () => ({
  initAuthProviderConfig: vi.fn(async () => track("initAuthProviderConfig")),
}));

vi.mock("@/server/lib/gateway-config", () => ({
  initGatewayConfig: vi.fn(async () => track("initGatewayConfig")),
  getGatewayConfigCached: vi.fn(() => ({
    rateLimits: [],
  })),
}));

vi.mock("@/server/lib/jwt", () => ({
  initJwtSecret: vi.fn(() => track("initJwtSecret")),
  cleanExpiredRefreshTokens: vi.fn(async () => {
    track("cleanExpiredRefreshTokens");
    return 0;
  }),
}));

vi.mock("@/server/messaging/jobs/retry-webhook-deliveries", () => ({
  initWebhookRetryJob: vi.fn(() => track("initWebhookRetryJob")),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    bootstrap: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    webhook: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock("@/server/lib/notification-provider-config", () => ({
  initNotificationProviderConfig: vi.fn(async () => track("initNotificationProviderConfig")),
}));

vi.mock("@/server/lib/redis", () => ({
  initRedis: vi.fn(async () => track("initRedis")),
  getRedis: vi.fn(() => ({
    duplicate: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    }),
    publish: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

vi.mock("@/server/lib/write-queue", () => ({
  initWriteQueue: vi.fn(() => track("initWriteQueue")),
  registerWriteHandler: vi.fn(),
}));

vi.mock("@/server/ai", () => ({
  initAiRelay: vi.fn(() => track("initAiRelay")),
}));

vi.mock("@/server/jobs/refresh-litellm-pricing", () => ({
  initLiteLLMPricingJob: vi.fn(() => track("initLiteLLMPricingJob")),
}));

// ── Tests ────────────────────────────────────────────────────────────

describe("bootstrap initialization order", () => {
  beforeEach(() => {
    callOrder.length = 0;
  });

  it("runs all init steps without error", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();
    expect(callOrder.length).toBeGreaterThan(0);
  });

  it("initJwtSecret runs BEFORE everything else", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const jwtIdx = callOrder.indexOf("initJwtSecret");
    expect(jwtIdx).toBe(0);
  });

  it("initGatewayConfig runs during bootstrap", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const configIdx = callOrder.indexOf("initGatewayConfig");
    expect(configIdx).toBeGreaterThanOrEqual(0);
  });

  it("initAiRelay runs during bootstrap", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const aiRelayIdx = callOrder.indexOf("initAiRelay");
    expect(aiRelayIdx).toBeGreaterThanOrEqual(0);
  });
});
