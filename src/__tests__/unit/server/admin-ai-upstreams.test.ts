import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindAllUpstreams = vi.fn();
const mockFindUpstreamById = vi.fn();
const mockCountAssignmentsByUpstreamIds = vi.fn();
const mockCountByUpstreamIds = vi.fn();
const mockUpstreamOverview = vi.fn();
const mockHourlyByUpstream = vi.fn();
const mockFindUsageLogs = vi.fn();
const mockFindLatestByUpstreamIds = vi.fn();
const mockDeleteMappingsByUpstreamId = vi.fn();
const mockInvalidateModelMappingCache = vi.fn();

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn().mockReturnValue({ adminId: 1 }),
}));

vi.mock("@/server/repos", () => ({
  aiProviderRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
  },
  aiUpstreamRepo: {
    findAll: (...args: unknown[]) => mockFindAllUpstreams(...args),
    findById: (...args: unknown[]) => mockFindUpstreamById(...args),
    findByUpstreamId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  aiUpstreamAssignmentRepo: {
    findByUpstreamId: vi.fn().mockResolvedValue([]),
    countByUpstreamIds: (...args: unknown[]) => mockCountAssignmentsByUpstreamIds(...args),
  },
  aiUpstreamModelMappingRepo: {
    findByUpstreamId: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteByUpstreamId: (...args: unknown[]) => mockDeleteMappingsByUpstreamId(...args),
  },
  aiKeyRepo: {
    countByUpstreamIds: (...args: unknown[]) => mockCountByUpstreamIds(...args),
  },
  aiUsageLogRepo: {
    upstreamOverview: (...args: unknown[]) => mockUpstreamOverview(...args),
    hourlyByUpstream: (...args: unknown[]) => mockHourlyByUpstream(...args),
    findAll: (...args: unknown[]) => mockFindUsageLogs(...args),
    findLatestByUpstreamIds: (...args: unknown[]) => mockFindLatestByUpstreamIds(...args),
  },
}));

vi.mock("@/server/ai/lib/key-balancer", () => ({
  invalidateKeyPool: vi.fn(),
}));

vi.mock("@/server/ai/lib/upstream-routing", () => ({
  invalidateUpstreamCache: vi.fn(),
  invalidateUpstreamCacheForUpstream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/ai/lib/model-mapping-cache", () => ({
  invalidateModelMappingCache: (...args: unknown[]) => mockInvalidateModelMappingCache(...args),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-upstreams");

const app = new Hono();
app.route("/", router);

describe("admin ai upstream routes", () => {
  beforeEach(() => {
    mockFindAllUpstreams.mockReset();
    mockFindUpstreamById.mockReset();
    mockCountAssignmentsByUpstreamIds.mockReset();
    mockCountByUpstreamIds.mockReset();
    mockUpstreamOverview.mockReset();
    mockHourlyByUpstream.mockReset();
    mockFindUsageLogs.mockReset();
    mockFindLatestByUpstreamIds.mockReset();
    mockDeleteMappingsByUpstreamId.mockReset();
    mockInvalidateModelMappingCache.mockReset();
  });

  it("returns upstream overview rows with derived health and latest status", async () => {
    mockFindAllUpstreams.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
        kind: "reseller",
        modelsEndpoint: "https://friend-a.example.com/v1/models",
        enabled: true,
        metadata: "{}",
        createdAt: new Date("2026-04-10T00:00:00Z"),
        updatedAt: new Date("2026-04-13T00:00:00Z"),
      },
    ]);
    mockCountAssignmentsByUpstreamIds.mockResolvedValue(new Map([[11, 2]]));
    mockCountByUpstreamIds.mockResolvedValue([{ upstreamId: 11, totalKeys: 2, enabledKeys: 1 }]);
    mockUpstreamOverview.mockResolvedValue([
      {
        upstreamId: 11,
        requests24h: 12,
        clientErrors24h: 1,
        serverErrors24h: 3,
        totalTokens24h: 64000,
        avgLatencyMs24h: 1800,
        lastSeenAt: "2026-04-13T03:00:00.000Z",
        recentRequests: 5,
        recentServerErrors: 2,
        recentTotalErrors: 2,
      },
    ]);
    mockFindLatestByUpstreamIds.mockResolvedValue(
      new Map([
        [
          11,
          {
            id: 99,
            upstreamId: 11,
            statusCode: 502,
            error: "bad gateway",
          },
        ],
      ]),
    );

    const res = await app.request("http://localhost/upstreams/overview?hours=24");
    const json = (await res.json()) as {
      data: {
        totals: {
          totalUpstreams: number;
          enabledUpstreams: number;
          activeUpstreams24h: number;
          degradedUpstreams30m: number;
        };
        upstreams: Array<{
          id: number;
          healthStatus: string;
          lastStatusCode: number | null;
          modelsEndpoint: string | null;
          enabledKeys: number;
          requests24h: number;
          assignmentCount: number;
        }>;
      };
    };

    expect(res.status).toBe(200);
    expect(mockCountByUpstreamIds).toHaveBeenCalledWith([11]);
    expect(mockFindLatestByUpstreamIds).toHaveBeenCalledWith([11]);
    expect(json.data.totals).toMatchObject({
      totalUpstreams: 1,
      enabledUpstreams: 1,
      activeUpstreams24h: 1,
      degradedUpstreams30m: 1,
    });
    expect(json.data.upstreams[0]).toMatchObject({
      id: 11,
      healthStatus: "degraded",
      lastStatusCode: 502,
      modelsEndpoint: "https://friend-a.example.com/v1/models",
      enabledKeys: 1,
      requests24h: 12,
      assignmentCount: 2,
    });
  });

  it("marks upstream idle when the last 30 minutes have no traffic", async () => {
    mockFindAllUpstreams.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
        kind: "reseller",
        enabled: true,
        metadata: "{}",
        createdAt: new Date("2026-04-10T00:00:00Z"),
        updatedAt: new Date("2026-04-13T00:00:00Z"),
      },
    ]);
    mockCountAssignmentsByUpstreamIds.mockResolvedValue(new Map([[11, 2]]));
    mockCountByUpstreamIds.mockResolvedValue([{ upstreamId: 11, totalKeys: 2, enabledKeys: 2 }]);
    mockUpstreamOverview.mockResolvedValue([
      {
        upstreamId: 11,
        requests24h: 12,
        clientErrors24h: 1,
        serverErrors24h: 0,
        totalTokens24h: 64000,
        avgLatencyMs24h: 1800,
        lastSeenAt: "2026-04-13T03:00:00.000Z",
        recentRequests: 0,
        recentServerErrors: 0,
        recentTotalErrors: 0,
      },
    ]);
    mockFindLatestByUpstreamIds.mockResolvedValue(new Map());

    const res = await app.request("http://localhost/upstreams/overview?hours=24");
    const json = (await res.json()) as {
      data: {
        totals: {
          degradedUpstreams30m: number;
        };
        upstreams: Array<{
          healthStatus: string;
        }>;
      };
    };

    expect(res.status).toBe(200);
    expect(json.data.totals.degradedUpstreams30m).toBe(0);
    expect(json.data.upstreams[0]?.healthStatus).toBe("idle");
  });

  it("returns recent logs for a specific upstream", async () => {
    mockFindUpstreamById.mockResolvedValue({
      id: 11,
      upstreamId: "friend-a",
      name: "Friend A",
      baseUrl: "https://friend-a.example.com",
      kind: "reseller",
      enabled: true,
      metadata: "{}",
    });
    mockFindUsageLogs.mockResolvedValue([
      {
        id: 1,
        upstreamId: 11,
        upstreamName: "Friend A",
        modelId: "claude-sonnet-4",
        statusCode: 200,
        totalTokens: 1200,
      },
    ]);

    const res = await app.request("http://localhost/upstreams/11/recent?limit=5");
    const json = (await res.json()) as {
      data: Array<{ upstreamId: number; upstreamName: string; modelId: string }>;
    };

    expect(res.status).toBe(200);
    expect(mockFindUsageLogs).toHaveBeenCalledWith(5, 0, { upstreamId: 11 });
    expect(json.data[0]).toMatchObject({
      upstreamId: 11,
      upstreamName: "Friend A",
      modelId: "claude-sonnet-4",
    });
  });

  it("returns hourly breakdown for a specific upstream", async () => {
    mockFindUpstreamById.mockResolvedValue({
      id: 11,
      upstreamId: "friend-a",
      name: "Friend A",
      baseUrl: "https://friend-a.example.com",
      kind: "reseller",
      enabled: true,
      metadata: "{}",
    });
    mockHourlyByUpstream.mockResolvedValue([
      {
        hour: "2026-04-13T00:00:00.000Z",
        requests: 8,
        clientErrors: 1,
        serverErrors: 0,
        avgLatencyMs: 420,
      },
      {
        hour: "2026-04-13T01:00:00.000Z",
        requests: 15,
        clientErrors: 0,
        serverErrors: 2,
        avgLatencyMs: 890,
      },
    ]);

    const res = await app.request("http://localhost/upstreams/11/hourly?hours=24");
    const json = (await res.json()) as {
      data: Array<{
        hour: string;
        requests: number;
        clientErrors: number;
        serverErrors: number;
        avgLatencyMs: number;
      }>;
    };

    expect(res.status).toBe(200);
    expect(mockHourlyByUpstream).toHaveBeenCalledWith(11, 24);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      hour: "2026-04-13T00:00:00.000Z",
      requests: 8,
      clientErrors: 1,
      serverErrors: 0,
      avgLatencyMs: 420,
    });
    expect(json.data[1]).toMatchObject({
      requests: 15,
      serverErrors: 2,
    });
  });

  it("clamps hours param for hourly endpoint", async () => {
    mockFindUpstreamById.mockResolvedValue({
      id: 11,
      upstreamId: "friend-a",
      name: "Friend A",
      baseUrl: "https://friend-a.example.com",
      kind: "reseller",
      enabled: true,
      metadata: "{}",
    });
    mockHourlyByUpstream.mockResolvedValue([]);

    await app.request("http://localhost/upstreams/11/hourly?hours=999");
    expect(mockHourlyByUpstream).toHaveBeenCalledWith(11, 72);
  });

  it("returns 404 for hourly endpoint with non-existent upstream", async () => {
    mockFindUpstreamById.mockResolvedValue(null);

    const res = await app.request("http://localhost/upstreams/999/hourly");
    expect(res.status).toBe(404);
  });

  it("deletes model mappings when deleting an upstream", async () => {
    mockFindUpstreamById.mockResolvedValue({
      id: 11,
      upstreamId: "friend-a",
      name: "Friend A",
      baseUrl: "https://friend-a.example.com",
      kind: "reseller",
      enabled: true,
      metadata: "{}",
    });

    const res = await app.request("http://localhost/upstreams/11", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(mockDeleteMappingsByUpstreamId).toHaveBeenCalledWith(11);
    expect(mockInvalidateModelMappingCache).toHaveBeenCalledWith(11);
  });
});
