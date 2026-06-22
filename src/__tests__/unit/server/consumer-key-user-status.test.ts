/**
 * Consumer key auth middleware — user status gate tests.
 *
 * Verifies that the middleware checks the owning user's status
 * (via LEFT JOIN in findByApiKeyHash) independently from key status.
 * This is the auth-time enforcement for user disable/enable.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumerKeyAuthMiddleware,
  getConsumerSession,
} from "@/server/ai/middleware/consumer-key-auth";

// ── Hoisted mock fns ────────────────────────────────────────────────

const {
  mockFindBlacklistedByHash,
  mockFindByHash,
  mockFindAgent,
  mockEnqueueJob,
  mockRateIncrement,
} = vi.hoisted(() => ({
  mockFindBlacklistedByHash: vi.fn(),
  mockFindByHash: vi.fn(),
  mockFindAgent: vi.fn(),
  mockEnqueueJob: vi.fn(),
  mockRateIncrement: vi.fn(),
}));

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/server/repos", () => ({
  relayConsumerKeyRepo: {
    findBlacklistedByApiKeyHash: (...args: unknown[]) => mockFindBlacklistedByHash(...args),
    findByApiKeyHash: (...args: unknown[]) => mockFindByHash(...args),
  },
  payAgentRepo: {
    findById: (...args: unknown[]) => mockFindAgent(...args),
  },
}));

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

vi.mock("@/server/rate-limit", () => ({
  createRateLimitStore: () => ({
    increment: (...args: unknown[]) => mockRateIncrement(...args),
    size: vi.fn(() => 0),
    cleanup: vi.fn(),
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────

const RAW_KEY = "ska_aabbccdd11223344aabbccdd11223344";

function buildConsumerRow(
  overrides: Partial<{
    status: string;
    userStatus: number | null;
    userId: number | null;
    agentId: number;
    expiresAt: Date | null;
    rateLimitRpm: number | null;
  }> = {},
) {
  return {
    id: 1,
    userId: "userId" in overrides ? overrides.userId : 10,
    agentId: overrides.agentId ?? 100,
    name: "Test Key",
    description: null,
    apiKeyHash: "mock-hash",
    apiKeyPrefix: "ska_aabb",
    encryptedKey: "",
    markupPercent: 0,
    rateLimitRpm: "rateLimitRpm" in overrides ? overrides.rateLimitRpm : null,
    allowedModels: "[]",
    status: overrides.status ?? "active",
    userStatus: "userStatus" in overrides ? overrides.userStatus : 1,
    expiresAt: overrides.expiresAt ?? null,
    lastUsedAt: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

function buildAgentRow(
  overrides: Partial<{
    status: string;
    balance: string;
  }> = {},
) {
  return {
    id: 100,
    name: "Test Agent",
    status: overrides.status ?? "active",
    balance: overrides.balance ?? "50.00",
    defaultMarkupPercent: 0,
    perPayLimit: null,
    dailyLimit: null,
    monthlyLimit: null,
  };
}

function buildBlacklistedRow(
  overrides: Partial<{
    relayConsumerKeyId: number | null;
    userId: number | null;
  }> = {},
) {
  return {
    id: 999,
    relayConsumerKeyId: "relayConsumerKeyId" in overrides ? overrides.relayConsumerKeyId : 1,
    userId: "userId" in overrides ? overrides.userId : 10,
    agentId: 100,
    name: "Deleted Key",
    apiKeyHash: "mock-hash",
    apiKeyPrefix: "ska_dead",
    deletedAt: new Date(),
  };
}

function createApp() {
  const app = new Hono();
  app.use("/*", consumerKeyAuthMiddleware);
  app.get("/test", (c) => {
    const session = getConsumerSession(c);
    return c.json({ consumerId: session.consumerId, userId: session.userId });
  });
  return app;
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRateIncrement.mockResolvedValue({ count: 1, resetMs: 60_000 });
});

// ── Tests ───────────────────────────────────────────────────────────

describe("consumer key auth — user status gate", () => {
  it("active user + active key → passes through (200)", async () => {
    mockFindByHash.mockResolvedValueOnce(buildConsumerRow({ userStatus: 1 }));
    mockFindAgent.mockResolvedValueOnce(buildAgentRow());

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.consumerId).toBe(1);
    expect(body.userId).toBe(10);
  });

  it("disabled user (userStatus=2) → 403 'Account is disabled'", async () => {
    mockFindByHash.mockResolvedValueOnce(buildConsumerRow({ userStatus: 2 }));

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Account is disabled");
    // Should NOT reach agent lookup
    expect(mockFindAgent).not.toHaveBeenCalled();
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "ai-usage-log",
      expect.objectContaining({
        statusCode: 403,
        error: "Account is disabled",
        consumerKeyId: 1,
        userId: 10,
      }),
    );
  });

  it("orphan key (userId=null, userStatus=null) → passes through (200)", async () => {
    mockFindByHash.mockResolvedValueOnce(buildConsumerRow({ userId: null, userStatus: null }));
    mockFindAgent.mockResolvedValueOnce(buildAgentRow());

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it("rateLimitRpm exceeded → 429 before agent lookup", async () => {
    mockFindByHash.mockResolvedValueOnce(buildConsumerRow({ rateLimitRpm: 1 }));
    mockRateIncrement.mockResolvedValueOnce({ count: 2, resetMs: 30_000 });

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    const body = await res.json();
    expect(body.error).toBe("Rate limit exceeded");
    expect(mockRateIncrement).toHaveBeenCalledWith("consumer-key:1", 60_000);
    expect(mockFindAgent).not.toHaveBeenCalled();
  });

  it("deleted key in blacklist → 403 'Consumer key has been deleted'", async () => {
    mockFindByHash.mockResolvedValueOnce(undefined);
    mockFindBlacklistedByHash.mockResolvedValueOnce(buildBlacklistedRow());

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Consumer key has been deleted");
    expect(mockFindAgent).not.toHaveBeenCalled();
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "ai-usage-log",
      expect.objectContaining({
        statusCode: 403,
        error: "Consumer key has been deleted",
        consumerKeyId: 1,
        userId: 10,
      }),
    );
  });

  it("suspended key + active user → 403 'Consumer key is suspended' (key check fires first)", async () => {
    mockFindByHash.mockResolvedValueOnce(buildConsumerRow({ status: "suspended", userStatus: 1 }));

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Consumer key is suspended");
    expect(mockFindAgent).not.toHaveBeenCalled();
  });

  it("disabled user check fires before expiry check", async () => {
    const futureDate = new Date(Date.now() + 3_600_000);
    mockFindByHash.mockResolvedValueOnce(
      buildConsumerRow({ userStatus: 2, expiresAt: futureDate }),
    );

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    // Should get "Account is disabled", not an expiry error
    expect(body.error).toBe("Account is disabled");
  });

  it("zero-balance agent passes auth (balance check deferred to route handler)", async () => {
    mockFindByHash.mockResolvedValueOnce(buildConsumerRow({ userStatus: 1 }));
    mockFindAgent.mockResolvedValueOnce(buildAgentRow({ balance: "0" }));

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.consumerId).toBe(1);
  });
});
