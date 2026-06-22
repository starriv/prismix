import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindProviders = vi.fn();
const mockCountKeysByProviderIds = vi.fn();
const mockProviderOverview = vi.fn();
const mockCountAssignmentsByProviderIds = vi.fn();
const mockSeedDefaultProviders = vi.fn();

vi.mock("@/server/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn().mockReturnValue({ adminId: 1 }),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock("@/server/ai/lib/key-balancer", () => ({
  invalidateKeyPool: vi.fn(),
}));

vi.mock("@/server/ai/lib/seed-providers", () => ({
  seedDefaultProviders: (...args: unknown[]) => mockSeedDefaultProviders(...args),
}));

vi.mock("@/server/ai/lib/upstream-routing", () => ({
  invalidateUpstreamCache: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiKeyRepo: {
    countByProviderIds: (...args: unknown[]) => mockCountKeysByProviderIds(...args),
    findByProviderId: vi.fn().mockResolvedValue([]),
  },
  aiProviderRepo: {
    findAll: (...args: unknown[]) => mockFindProviders(...args),
    findById: vi.fn(),
    findByProviderId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  aiUpstreamAssignmentRepo: {
    countByProviderIds: (...args: unknown[]) => mockCountAssignmentsByProviderIds(...args),
    findByProviderId: vi.fn().mockResolvedValue([]),
    findByProviderAndUpstreamId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  aiUpstreamRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
  },
  aiUsageLogRepo: {
    providerOverview: (...args: unknown[]) => mockProviderOverview(...args),
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-providers");

const app = new Hono();
app.route("/", router);

describe("admin ai providers overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSeedDefaultProviders.mockResolvedValue(undefined);
    mockCountKeysByProviderIds.mockResolvedValue([{ providerId: 7, totalKeys: 1, enabledKeys: 1 }]);
    mockProviderOverview.mockResolvedValue([]);
    mockCountAssignmentsByProviderIds.mockResolvedValue(new Map([[7, 2]]));
  });

  it("seeds default providers before building the overview on first access", async () => {
    mockFindProviders.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 7,
        providerId: "anthropic",
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        apiFormat: "anthropic",
        authType: "bearer",
        authConfig: "{}",
        enabled: true,
        loadBalanceStrategy: "round-robin",
        upstreamRoutingStrategy: "priority",
        iconUrl: null,
        healthStatus: "unknown",
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        consecutiveFailures: 0,
        autoDisabled: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await app.request("http://localhost/providers/overview?hours=24");
    const json = (await res.json()) as {
      data: { totals: { totalProviders: number }; providers: Array<{ providerId: string }> };
    };

    expect(res.status).toBe(200);
    expect(mockSeedDefaultProviders).toHaveBeenCalledTimes(1);
    expect(mockFindProviders).toHaveBeenCalledTimes(2);
    expect(mockCountKeysByProviderIds).toHaveBeenCalledWith([7]);
    expect(json.data.totals.totalProviders).toBe(1);
    expect(json.data.providers[0]?.providerId).toBe("anthropic");
  });
});
