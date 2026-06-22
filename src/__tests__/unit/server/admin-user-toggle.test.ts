/**
 * Admin user disable/enable — unit tests.
 *
 * Verifies that disable/enable only toggle user.status and do NOT
 * cascade to consumer key statuses. Consumer key access is gated by
 * the auth middleware checking user status via LEFT JOIN at request time.
 */
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initJwtSecret, signAccessToken } from "@/server/lib/jwt";

// ── Hoisted mock fns ────────────────────────────────────────────────

const { mockUserFindById, mockUserUpdate } = vi.hoisted(() => ({
  mockUserFindById: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/server/db", () => ({
  transaction: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock("@/server/repos", () => ({
  userRepo: {
    findById: mockUserFindById,
    findAll: vi.fn(async () => []),
    update: mockUserUpdate,
  },
  // Stubs for other repos imported by admin.ts
  adminRepo: { findByAddress: vi.fn(), create: vi.fn() },
  identityRepo: {},
  networkRepo: { findAll: vi.fn(async () => []) },
  payAgentRepo: { findAll: vi.fn(async () => []) },
  payAgentTransactionRepo: {},
  announcementRepo: { findAll: vi.fn(async () => []) },
  refreshTokenRepo: {},
  withdrawOrderRepo: {},
  apiKeyRepo: { findByHash: vi.fn() },
}));

vi.mock("@/server/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("@/server/lib/wallet", () => ({
  ensureAgentWallet: vi.fn(),
}));

vi.mock("@/server/cache", () => ({
  createCacheStore: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    has: vi.fn(() => false),
    clear: vi.fn(),
    size: vi.fn(() => 0),
  })),
  lazyCacheStore: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    has: vi.fn(() => false),
    clear: vi.fn(),
    size: vi.fn(() => 0),
  })),
}));

vi.mock("@/server/lib/auth-provider-config", () => ({
  getAuthProviderConfigCached: vi.fn(async () => ({})),
  saveAuthProviderConfig: vi.fn(),
}));

vi.mock("@/server/lib/notification-provider-config", () => ({
  getNotificationProviderConfigCached: vi.fn(async () => ({})),
  saveNotificationProviderConfig: vi.fn(),
}));

// ── Setup ───────────────────────────────────────────────────────────

let adminToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-for-admin-toggle-test-32chars!!";
  initJwtSecret();
  adminToken = await signAccessToken({ userId: 1, role: "admin" });
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── App ─────────────────────────────────────────────────────────────

async function createApp() {
  const { default: adminUsers } = await import("@/server/admin/routes/admin-users");
  const { adminAuthMiddleware } = await import("@/server/middleware/auth");
  const app = new Hono();
  app.use("/*", adminAuthMiddleware);
  app.route("/", adminUsers);
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("admin user disable/enable — no cascade to consumer keys", () => {
  it("disable only sets user status to 2", async () => {
    mockUserFindById.mockResolvedValueOnce({ id: 42, status: 1 });
    mockUserUpdate.mockResolvedValueOnce(undefined);

    const app = await createApp();
    const res = await app.request("/users/42/disable", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(42, { status: 2 });
  });

  it("enable only sets user status to 1", async () => {
    mockUserFindById.mockResolvedValueOnce({ id: 42, status: 2 });
    mockUserUpdate.mockResolvedValueOnce(undefined);

    const app = await createApp();
    const res = await app.request("/users/42/enable", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(42, { status: 1 });
  });

  it("enable on already-active user returns 400", async () => {
    mockUserFindById.mockResolvedValueOnce({ id: 42, status: 1 });

    const app = await createApp();
    const res = await app.request("/users/42/enable", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("disable on already-disabled user returns 400", async () => {
    mockUserFindById.mockResolvedValueOnce({ id: 42, status: 2 });

    const app = await createApp();
    const res = await app.request("/users/42/disable", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
