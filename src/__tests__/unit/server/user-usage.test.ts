/**
 * User Usage — unit tests for user-scoped usage summary and daily aggregates.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSummary = vi.fn();
const mockDailySummary = vi.fn();

vi.mock("@/server/repos", () => ({
  announcementRepo: { findRecentSent: vi.fn().mockResolvedValue([]) },
  aiModelRepo: { findAllEnabled: vi.fn().mockResolvedValue([]) },
  aiUsageLogRepo: {
    summary: (...args: unknown[]) => mockSummary(...args),
    dailySummary: (...args: unknown[]) => mockDailySummary(...args),
    errorOverview: vi.fn().mockResolvedValue({
      total4xx: 0,
      total5xx: 0,
      last24h4xx: 0,
      last24h5xx: 0,
      peak4xx: 0,
      peak4xxDate: null,
      peak5xx: 0,
      peak5xxDate: null,
    }),
    errorDaily: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  payAgentRepo: { findById: vi.fn() },
  relayConsumerKeyRepo: {
    findByUserId: vi.fn().mockResolvedValue([]),
    findByIdAndUser: vi.fn(),
    create: vi.fn(),
  },
  settingsRepo: { getGlobal: vi.fn() },
  userRepo: { findById: vi.fn(), update: vi.fn() },
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock("@/server/middleware/auth", () => ({
  getUserSession: () => ({ userId: 42, address: "0xuser", role: "user" }),
}));

vi.mock("@/server/lib/crypto", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted"),
  decrypt: vi.fn().mockReturnValue("decrypted"),
  generateConsumerApiKey: vi.fn().mockReturnValue({
    raw: "key",
    hash: "hash",
    prefix: "prefix",
  }),
}));

vi.mock("@/server/lib/wallet", () => ({
  ensureUserAgent: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/server/ai/middleware/consumer-key-auth", () => ({
  getGlobalDefaultMarkup: vi.fn().mockResolvedValue(20),
}));

vi.mock("@/server/ai/lib/safe-json", () => ({
  safeParseJsonArray: vi.fn().mockReturnValue([]),
}));

const { default: userRouter } = await import("@/server/user/routes/user");
const app = new Hono();
app.route("/api/user", userRouter);

describe("user usage routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSummary.mockResolvedValue({
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalEstimatedCost: 0,
      errorCount: 0,
      errorRate: 0,
      byEndpoint: [],
      byModel: [],
    });
    mockDailySummary.mockResolvedValue([]);
  });

  it("GET /api/user/usage/summary scopes the aggregate to the current user", async () => {
    const res = await app.request("http://localhost/api/user/usage/summary", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(mockSummary).toHaveBeenCalledWith(undefined, undefined, undefined, 42);
  });

  it("GET /api/user/usage/daily scopes to the current user and clamps days", async () => {
    const res = await app.request("http://localhost/api/user/usage/daily?days=999", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(mockDailySummary).toHaveBeenCalledWith(90, undefined, 42);
  });

  it("GET /api/user/usage/daily clamps days=0 to 1", async () => {
    await app.request("http://localhost/api/user/usage/daily?days=0", { method: "GET" });

    expect(mockDailySummary).toHaveBeenCalledWith(1, undefined, 42);
  });

  it("GET /api/user/usage/daily clamps negative days to 1", async () => {
    await app.request("http://localhost/api/user/usage/daily?days=-5", { method: "GET" });

    expect(mockDailySummary).toHaveBeenCalledWith(1, undefined, 42);
  });

  it("GET /api/user/usage/daily falls back to 30 days for an empty days param", async () => {
    await app.request("http://localhost/api/user/usage/daily?days=", { method: "GET" });

    expect(mockDailySummary).toHaveBeenCalledWith(30, undefined, 42);
  });

  it("GET /api/user/usage/daily falls back to 30 days for invalid input", async () => {
    await app.request("http://localhost/api/user/usage/daily?days=not-a-number", {
      method: "GET",
    });

    expect(mockDailySummary).toHaveBeenCalledWith(30, undefined, 42);
  });
});
