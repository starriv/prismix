/**
 * User Logs — unit tests for GET /api/user/logs and /api/user/logs/request/:requestId.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindAll = vi.fn();
const mockCount = vi.fn();
const mockGetRequestLog = vi.fn();

vi.mock("@/server/repos", () => ({
  announcementRepo: { findRecentSent: vi.fn().mockResolvedValue([]) },
  aiModelRepo: { findAllEnabled: vi.fn().mockResolvedValue([]) },
  aiUsageLogRepo: {
    summary: vi.fn().mockResolvedValue({}),
    dailySummary: vi.fn().mockResolvedValue([]),
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
    findAll: (...args: unknown[]) => mockFindAll(...args),
    count: (...args: unknown[]) => mockCount(...args),
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
    gateway: { info: vi.fn() },
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

vi.mock("@/server/ai/log-store", () => ({
  getRequestLog: (...args: unknown[]) => mockGetRequestLog(...args),
}));

const { default: userRouter } = await import("@/server/user/routes/user");
const app = new Hono();
app.route("/api/user", userRouter);

describe("GET /api/user/logs", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCount.mockReset();
    mockGetRequestLog.mockReset();
    mockFindAll.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("applies user scope and 4xx status filtering", async () => {
    await app.request(
      new Request("http://localhost/api/user/logs?statusClass=4xx&modelId=claude-3-7", {
        method: "GET",
      }),
    );

    expect(mockFindAll).toHaveBeenCalledWith(10, 0, {
      userId: 42,
      modelId: "claude-3-7",
      statusClass: "4xx",
    });
    expect(mockCount).toHaveBeenCalledWith({
      userId: 42,
      modelId: "claude-3-7",
      statusClass: "4xx",
    });
  });

  it("ignores unsupported status classes instead of widening the query", async () => {
    await app.request(
      new Request("http://localhost/api/user/logs?statusClass=2xx&limit=5&offset=15", {
        method: "GET",
      }),
    );

    expect(mockFindAll).toHaveBeenCalledWith(5, 15, {
      userId: 42,
      modelId: undefined,
      statusClass: undefined,
    });
    expect(mockCount).toHaveBeenCalledWith({
      userId: 42,
      modelId: undefined,
      statusClass: undefined,
    });
  });
});

describe("GET /api/user/logs/request/:requestId", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCount.mockReset();
    mockGetRequestLog.mockReset();
  });

  it("returns 404 when the request does not belong to the current user", async () => {
    mockFindAll.mockResolvedValue([]);

    const res = await app.request(
      new Request("http://localhost/api/user/logs/request/req-other-user", { method: "GET" }),
    );

    expect(res.status).toBe(404);
    expect(mockFindAll).toHaveBeenCalledWith(1, 0, {
      userId: 42,
      requestId: "req-other-user",
    });
    expect(mockGetRequestLog).not.toHaveBeenCalled();
  });

  it("returns the request log when ownership check passes", async () => {
    mockFindAll.mockResolvedValue([{ id: 1, requestId: "req-owned" }]);
    mockGetRequestLog.mockResolvedValue({
      requestId: "req-owned",
      body: { model: "claude-3-7" },
      response: { error: "upstream timeout" },
    });

    const res = await app.request(
      new Request("http://localhost/api/user/logs/request/req-owned", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    expect(mockGetRequestLog).toHaveBeenCalledWith("req-owned");
    const json = (await res.json()) as {
      data: { requestId: string; body: { model: string }; response: { error: string } };
    };
    expect(json.data.requestId).toBe("req-owned");
    expect(json.data.body.model).toBe("claude-3-7");
  });
});
