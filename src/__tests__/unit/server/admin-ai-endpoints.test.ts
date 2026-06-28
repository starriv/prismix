import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEndpoints = vi.fn();
const mockCountCredentialsByEndpointIds = vi.fn();
const mockEndpointOverview = vi.fn();
const mockCountAssignmentsByEndpointIds = vi.fn();
const mockSeedDefaultEndpoints = vi.fn();

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

vi.mock("@/server/ai/lib/credential-balancer", () => ({
  invalidateCredentialPool: vi.fn(),
}));

vi.mock("@/server/ai/lib/seed-endpoints", () => ({
  seedDefaultEndpoints: (...args: unknown[]) => mockSeedDefaultEndpoints(...args),
}));

vi.mock("@/server/ai/lib/upstream-routing", () => ({
  invalidateUpstreamCache: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiEndpointCredentialRepo: {
    countByEndpointIds: (...args: unknown[]) => mockCountCredentialsByEndpointIds(...args),
    findByEndpointId: vi.fn().mockResolvedValue([]),
  },
  aiEndpointRepo: {
    findAllWithSupplier: (...args: unknown[]) => mockFindEndpoints(...args),
    findById: vi.fn(),
    findByEndpointId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  aiUpstreamAssignmentRepo: {
    countByEndpointIds: (...args: unknown[]) => mockCountAssignmentsByEndpointIds(...args),
    findByEndpointId: vi.fn().mockResolvedValue([]),
    findByEndpointAndUpstreamId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  aiUpstreamRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
  },
  aiUsageLogRepo: {
    endpointOverview: (...args: unknown[]) => mockEndpointOverview(...args),
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-endpoints");

const app = new Hono();
app.route("/", router);

describe("admin ai endpoints overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSeedDefaultEndpoints.mockResolvedValue(undefined);
    mockCountCredentialsByEndpointIds.mockResolvedValue([
      { endpointId: 7, totalCredentials: 1, enabledCredentials: 1 },
    ]);
    mockEndpointOverview.mockResolvedValue([]);
    mockCountAssignmentsByEndpointIds.mockResolvedValue(new Map([[7, 2]]));
  });

  it("seeds default endpoints before building the overview on first access", async () => {
    mockFindEndpoints.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 7,
        supplierId: 1,
        supplier: { id: 1, supplierId: "anthropic", name: "Anthropic", enabled: true },
        endpointId: "anthropic",
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

    const res = await app.request("http://localhost/endpoints/overview?hours=24");
    const json = (await res.json()) as {
      data: { totals: { totalEndpoints: number }; endpoints: Array<{ endpointId: string }> };
    };

    expect(res.status).toBe(200);
    expect(mockSeedDefaultEndpoints).toHaveBeenCalledTimes(1);
    expect(mockFindEndpoints).toHaveBeenCalledTimes(2);
    expect(mockCountCredentialsByEndpointIds).toHaveBeenCalledWith([7]);
    expect(json.data.totals.totalEndpoints).toBe(1);
    expect(json.data.endpoints[0]?.endpointId).toBe("anthropic");
  });
});
