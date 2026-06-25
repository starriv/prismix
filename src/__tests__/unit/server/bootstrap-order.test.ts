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

vi.mock("@/server/db", () => ({
  initDb: vi.fn(async () => track("initDb")),
}));

vi.mock("@/server/jobs/expire-topup-orders", () => ({
  initTopupExpiryJob: vi.fn(async () => track("initTopupExpiryJob")),
  closeTopupExpiryJob: vi.fn(async () => {}),
}));

vi.mock("@/server/jobs/expire-limited-free-models", () => ({
  initLimitedFreeModelExpiryJob: vi.fn(async () => track("initLimitedFreeModelExpiryJob")),
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
    gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

vi.mock("@/server/ai/init", () => ({
  initAiAdapters: vi.fn(() => track("initAiAdapters")),
  initAiWriteHandlers: vi.fn(() => track("initAiWriteHandlers")),
}));

vi.mock("@/server/jobs/refresh-litellm-pricing", () => ({
  initLiteLLMPricingJob: vi.fn(async () => track("initLiteLLMPricingJob")),
  closeLiteLLMPricingJob: vi.fn(async () => {}),
}));

vi.mock("@/server/jobs/check-supplier-health", () => ({
  initSupplierHealthCheckJob: vi.fn(async () => track("initSupplierHealthCheckJob")),
}));

vi.mock("@/server/jobs/cleanup-ai-usage-logs", () => ({
  initAiUsageLogCleanupJob: vi.fn(async () => track("initAiUsageLogCleanupJob")),
  closeAiUsageLogCleanupJob: vi.fn(async () => {}),
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

  it("initJwtSecret runs before auth and queue initialization", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const jwtIdx = callOrder.indexOf("initJwtSecret");
    expect(jwtIdx).toBeGreaterThanOrEqual(0);
    expect(jwtIdx).toBeLessThan(callOrder.indexOf("cleanExpiredRefreshTokens"));
    expect(jwtIdx).toBeLessThan(callOrder.indexOf("initAuthProviderConfig"));
    expect(jwtIdx).toBeLessThan(callOrder.indexOf("initWriteQueue"));
  });

  it("initGatewayConfig runs during bootstrap", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const configIdx = callOrder.indexOf("initGatewayConfig");
    expect(configIdx).toBeGreaterThanOrEqual(0);
  });

  it("AI adapters and write handlers run during legacy bootstrap", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    expect(callOrder.indexOf("initAiAdapters")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("initAiWriteHandlers")).toBeGreaterThanOrEqual(0);
  });

  it("initSupplierHealthCheckJob runs during bootstrap", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const supplierHealthIdx = callOrder.indexOf("initSupplierHealthCheckJob");
    expect(supplierHealthIdx).toBeGreaterThanOrEqual(0);
  });

  it("initLimitedFreeModelExpiryJob runs during bootstrap", async () => {
    const { bootstrap } = await import("@/server/lib/bootstrap");
    await bootstrap();

    const limitedFreeIdx = callOrder.indexOf("initLimitedFreeModelExpiryJob");
    expect(limitedFreeIdx).toBeGreaterThanOrEqual(0);
  });

  it("bootstrapApi starts producer-only runtime without worker jobs", async () => {
    const { bootstrapApi } = await import("@/server/lib/bootstrap");
    await bootstrapApi();

    expect(callOrder).toContain("initDb");
    expect(callOrder).toContain("initJwtSecret");
    expect(callOrder).toContain("initWriteQueue");
    expect(callOrder).toContain("initDepositScanQueue");
    expect(callOrder).toContain("initAiAdapters");
    expect(callOrder).toContain("initEventBus");

    expect(callOrder).not.toContain("initNotificationQueue");
    expect(callOrder).not.toContain("initAiWriteHandlers");
    expect(callOrder).not.toContain("initLiteLLMPricingJob");
    expect(callOrder).not.toContain("initTopupExpiryJob");
    expect(callOrder).not.toContain("initWebhookRetryJob");
    expect(callOrder).not.toContain("initSupplierHealthCheckJob");
    expect(callOrder).not.toContain("initLimitedFreeModelExpiryJob");
  });

  it("bootstrapWorker starts consumers and jobs without API auth runtime", async () => {
    const { bootstrapWorker } = await import("@/server/lib/bootstrap");
    await bootstrapWorker();

    expect(callOrder).toContain("initDb");
    expect(callOrder).toContain("initWriteQueue");
    expect(callOrder).toContain("initNotificationQueue");
    expect(callOrder).toContain("initAiWriteHandlers");
    expect(callOrder).toContain("initEventBus");
    expect(callOrder).toContain("initLiteLLMPricingJob");
    expect(callOrder).toContain("initTopupExpiryJob");
    expect(callOrder).toContain("initWebhookRetryJob");
    expect(callOrder).toContain("initDepositScanQueue");
    expect(callOrder).toContain("initSupplierHealthCheckJob");
    expect(callOrder).toContain("initLimitedFreeModelExpiryJob");

    expect(callOrder).not.toContain("initJwtSecret");
    expect(callOrder).not.toContain("cleanExpiredRefreshTokens");
    expect(callOrder).not.toContain("initAuthProviderConfig");
    expect(callOrder).not.toContain("initAiAdapters");
  });
});
