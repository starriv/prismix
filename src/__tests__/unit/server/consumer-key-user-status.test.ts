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

const { mockFindByHash, mockFindAgent, mockEnqueueJob } = vi.hoisted(() => ({
  mockFindByHash: vi.fn(),
  mockFindAgent: vi.fn(),
  mockEnqueueJob: vi.fn(),
}));

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/server/repos", () => ({
  relayConsumerKeyRepo: {
    findByApiKeyHash: (...args: unknown[]) => mockFindByHash(...args),
  },
  payAgentRepo: {
    findById: (...args: unknown[]) => mockFindAgent(...args),
  },
}));

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
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
    rateLimitRpm: null,
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
});
