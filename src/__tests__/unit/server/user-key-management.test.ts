/**
 * User key management — unit tests for disabling and deleting consumer keys.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindByIdAndUser = vi.fn();
const mockUpdate = vi.fn();
const mockBlacklistAndDelete = vi.fn();

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
    findAll: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  payAgentRepo: { findById: vi.fn() },
  relayConsumerKeyRepo: {
    findByUserId: vi.fn().mockResolvedValue([]),
    findByIdAndUser: (...args: unknown[]) => mockFindByIdAndUser(...args),
    create: vi.fn(),
    update: (...args: unknown[]) => mockUpdate(...args),
    blacklistAndDelete: (...args: unknown[]) => mockBlacklistAndDelete(...args),
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

function buildKey(overrides: Partial<{ id: number; status: string }> = {}) {
  return {
    id: overrides.id ?? 7,
    userId: 42,
    agentId: 99,
    name: "Leaked Key",
    description: null,
    apiKeyHash: "hash",
    apiKeyPrefix: "ska_leak",
    encryptedKey: "encrypted",
    markupPercent: null,
    rateLimitRpm: null,
    allowedModels: "[]",
    status: overrides.status ?? "active",
    expiresAt: null,
    lastUsedAt: null,
    updatedAt: new Date("2026-04-15T00:00:00Z"),
    createdAt: new Date("2026-04-14T00:00:00Z"),
  };
}

describe("user key management routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/user/keys/:id/disable suspends the owned key", async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(buildKey());
    mockUpdate.mockResolvedValueOnce(buildKey({ status: "suspended" }));

    const res = await app.request("http://localhost/api/user/keys/7/disable", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(7, 42, { status: "suspended" });

    const json = (await res.json()) as { data: { status: string } };
    expect(json.data.status).toBe("suspended");
  });

  it("POST /api/user/keys/:id/enable re-activates the owned key", async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(buildKey({ status: "suspended" }));
    mockUpdate.mockResolvedValueOnce(buildKey({ status: "active" }));

    const res = await app.request("http://localhost/api/user/keys/7/enable", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(7, 42, { status: "active" });

    const json = (await res.json()) as { data: { status: string } };
    expect(json.data.status).toBe("active");
  });

  it("DELETE /api/user/keys/:id blacklists then deletes the owned key", async () => {
    const key = buildKey();
    mockFindByIdAndUser.mockResolvedValueOnce(key);

    const res = await app.request("http://localhost/api/user/keys/7", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(mockBlacklistAndDelete).toHaveBeenCalledWith(key);

    const json = (await res.json()) as { data: { success: boolean } };
    expect(json.data.success).toBe(true);
  });

  it("POST /api/user/keys/:id/disable returns 409 when key is already suspended", async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(buildKey({ status: "suspended" }));

    const res = await app.request("http://localhost/api/user/keys/7/disable", {
      method: "POST",
    });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("POST /api/user/keys/:id/enable returns 409 when key is already active", async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(buildKey({ status: "active" }));

    const res = await app.request("http://localhost/api/user/keys/7/enable", {
      method: "POST",
    });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("DELETE /api/user/keys/:id returns 404 when the key is not owned by the user", async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(undefined);

    const res = await app.request("http://localhost/api/user/keys/7", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    expect(mockBlacklistAndDelete).not.toHaveBeenCalled();
  });
});
