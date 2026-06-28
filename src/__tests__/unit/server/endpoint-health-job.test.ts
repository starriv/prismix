import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindAnyEnabledByEndpoint = vi.fn();
const mockFindAnyEnabledByUpstream = vi.fn();
const mockFindEnabledModelsByEndpointId = vi.fn();
const mockEndpointUpdateHealth = vi.fn();
const mockEndpointFindById = vi.fn();
const mockEndpointRecordSuccess = vi.fn();
const mockEndpointRecordFailure = vi.fn();
const mockEndpointMarkAutoDisabled = vi.fn();
const mockEndpointMarkAutoReenabled = vi.fn();
const mockUpstreamFindByIds = vi.fn();
const mockUpstreamFindById = vi.fn();
const mockUpstreamUpdateHealth = vi.fn();
const mockUpstreamRecordSuccess = vi.fn();
const mockUpstreamRecordFailure = vi.fn();
const mockUpstreamMarkAutoDisabled = vi.fn();
const mockUpstreamMarkAutoReenabled = vi.fn();
const mockFindAssignmentsByEndpointId = vi.fn();
const mockPingEndpoint = vi.fn();
const mockEmit = vi.fn();

vi.mock("@/server/events", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: (value: string) => `plain:${value}`,
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    endpoint: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock("@/server/repos", () => ({
  aiEndpointCredentialRepo: {
    findAnyEnabledByEndpoint: (...args: unknown[]) => mockFindAnyEnabledByEndpoint(...args),
    findAnyEnabledByUpstream: (...args: unknown[]) => mockFindAnyEnabledByUpstream(...args),
  },
  aiModelRepo: {
    findEnabledByEndpointId: (...args: unknown[]) => mockFindEnabledModelsByEndpointId(...args),
  },
  aiEndpointRepo: {
    updateHealth: (...args: unknown[]) => mockEndpointUpdateHealth(...args),
    findById: (...args: unknown[]) => mockEndpointFindById(...args),
    recordSuccess: (...args: unknown[]) => mockEndpointRecordSuccess(...args),
    recordFailure: (...args: unknown[]) => mockEndpointRecordFailure(...args),
    markAutoDisabled: (...args: unknown[]) => mockEndpointMarkAutoDisabled(...args),
    markAutoReenabled: (...args: unknown[]) => mockEndpointMarkAutoReenabled(...args),
  },
  aiUpstreamRepo: {
    findByIds: (...args: unknown[]) => mockUpstreamFindByIds(...args),
    updateHealth: (...args: unknown[]) => mockUpstreamUpdateHealth(...args),
    findById: (...args: unknown[]) => mockUpstreamFindById(...args),
    recordSuccess: (...args: unknown[]) => mockUpstreamRecordSuccess(...args),
    recordFailure: (...args: unknown[]) => mockUpstreamRecordFailure(...args),
    markAutoDisabled: (...args: unknown[]) => mockUpstreamMarkAutoDisabled(...args),
    markAutoReenabled: (...args: unknown[]) => mockUpstreamMarkAutoReenabled(...args),
  },
  aiUpstreamAssignmentRepo: {
    findByEndpointId: (...args: unknown[]) => mockFindAssignmentsByEndpointId(...args),
  },
}));

vi.mock("@/server/ai/lib/endpoint-health", () => ({
  pingEndpoint: (...args: unknown[]) => mockPingEndpoint(...args),
}));

process.env.ENDPOINT_HEALTH_CHECK_FAILURE_THRESHOLD = "2";
process.env.ENDPOINT_HEALTH_CHECK_FAILURE_WINDOW_MS = "180000";

const { checkEndpoint } = await import("@/server/jobs/check-endpoint-health");

function endpointFixture() {
  return {
    id: 1,
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    authType: "bearer",
    authConfig: "{}",
    enabled: true,
    autoDisabled: false,
  } as never;
}

describe("endpoint health job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPingEndpoint.mockResolvedValue({ ok: true, status: 200, latencyMs: 12 });
    mockEndpointFindById.mockResolvedValue({
      id: 1,
      autoDisabled: false,
      consecutiveFailures: 0,
      lastFailureAt: null,
    });
    mockUpstreamFindById.mockImplementation(async (id: number) => ({
      id,
      autoDisabled: false,
      consecutiveFailures: 0,
      lastFailureAt: null,
    }));
    mockFindAssignmentsByEndpointId.mockResolvedValue([]);
    mockUpstreamFindByIds.mockResolvedValue([]);
    mockFindAnyEnabledByEndpoint.mockResolvedValue({ id: 100, encryptedKey: "endpoint-key" });
    mockFindAnyEnabledByUpstream.mockResolvedValue({ id: 101, encryptedKey: "upstream-key" });
    mockFindEnabledModelsByEndpointId.mockResolvedValue([]);
  });

  it("checks upstreams with upstream-scoped keys even when the endpoint has no default credential", async () => {
    mockFindAnyEnabledByEndpoint.mockResolvedValue(null);
    mockFindAnyEnabledByUpstream.mockImplementation(
      async (_endpointId: number, upstreamId: number) =>
        upstreamId === 10
          ? { id: 101, encryptedKey: "upstream-10" }
          : { id: 102, encryptedKey: "upstream-11" },
    );
    mockFindAssignmentsByEndpointId.mockResolvedValue([{ upstreamId: 10 }, { upstreamId: 11 }]);
    mockUpstreamFindByIds.mockResolvedValue([
      {
        id: 10,
        name: "Proxy A",
        baseUrl: "https://proxy-a.example.com",
        modelsEndpoint: "https://proxy-a.example.com/v1/models",
        enabled: true,
        autoDisabled: false,
      },
      {
        id: 11,
        name: "Proxy B",
        baseUrl: "https://proxy-b.example.com",
        modelsEndpoint: null,
        enabled: true,
        autoDisabled: false,
      },
    ]);

    await checkEndpoint(endpointFixture());

    expect(mockEndpointUpdateHealth).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        healthStatus: "degraded",
        lastError: "No enabled endpoint credential configured",
      }),
    );
    expect(mockFindAnyEnabledByUpstream).toHaveBeenCalledWith(1, 10);
    expect(mockFindAnyEnabledByUpstream).toHaveBeenCalledWith(1, 11);
    expect(mockPingEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://proxy-a.example.com",
        modelsEndpointOverride: "https://proxy-a.example.com/v1/models",
        plainKey: "plain:upstream-10",
      }),
    );
    expect(mockPingEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://proxy-b.example.com",
        modelsEndpointOverride: null,
        plainKey: "plain:upstream-11",
      }),
    );
    expect(mockUpstreamRecordSuccess).toHaveBeenCalledWith(10);
    expect(mockUpstreamRecordSuccess).toHaveBeenCalledWith(11);
  });

  it("does not notify on the first failed check", async () => {
    mockPingEndpoint.mockResolvedValue({
      ok: false,
      status: 503,
      error: "upstream-timeout",
      latencyMs: 10,
    });
    mockEndpointFindById
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 0,
        lastFailureAt: null,
      })
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 1,
        lastFailureAt: new Date(),
      });

    await checkEndpoint(endpointFixture());

    expect(mockEndpointRecordFailure).toHaveBeenCalledWith(1, "upstream-timeout");
    expect(mockEndpointMarkAutoDisabled).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith(
      "endpoint.disabled",
      expect.anything(),
      expect.anything(),
    );
  });

  it("notifies on the second failed check within the 3 minute window", async () => {
    mockPingEndpoint.mockResolvedValue({
      ok: false,
      status: 503,
      error: "upstream-timeout",
      latencyMs: 10,
    });
    mockEndpointFindById
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 1,
        lastFailureAt: new Date(Date.now() - 60_000),
      })
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 2,
        lastFailureAt: new Date(),
      });

    await checkEndpoint(endpointFixture());

    expect(mockEndpointMarkAutoDisabled).toHaveBeenCalledWith(1, "upstream-timeout");
    expect(mockEmit).toHaveBeenCalledWith(
      "endpoint.disabled",
      null,
      expect.objectContaining({
        title: "Endpoint 已自动禁用: OpenAI",
        body: expect.stringContaining("在 3 分钟内累计 2 次连通性检查失败"),
      }),
    );
  });

  it("resets stale failure counts before recording a new failure", async () => {
    mockPingEndpoint.mockResolvedValue({
      ok: false,
      status: 503,
      error: "upstream-timeout",
      latencyMs: 10,
    });
    mockEndpointFindById
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 1,
        lastFailureAt: new Date(Date.now() - 4 * 60_000),
      })
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 1,
        lastFailureAt: new Date(),
      });

    await checkEndpoint(endpointFixture());

    expect(mockEndpointUpdateHealth).toHaveBeenCalledWith(1, { consecutiveFailures: 0 });
    expect(mockEndpointRecordFailure).toHaveBeenCalledWith(1, "upstream-timeout");
    expect(mockEndpointMarkAutoDisabled).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith(
      "endpoint.disabled",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not auto-disable an endpoint with bound upstreams even when failures exceed threshold", async () => {
    mockPingEndpoint.mockResolvedValue({
      ok: false,
      status: 503,
      error: "endpoint-down",
      latencyMs: 10,
    });
    mockFindAssignmentsByEndpointId.mockResolvedValue([{ upstreamId: 10 }]);
    mockUpstreamFindByIds.mockResolvedValue([
      {
        id: 10,
        name: "Proxy A",
        baseUrl: "https://proxy-a.example.com",
        modelsEndpoint: null,
        enabled: true,
        autoDisabled: false,
      },
    ]);
    mockEndpointFindById
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 5,
        lastFailureAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 1,
        autoDisabled: false,
        consecutiveFailures: 6,
        lastFailureAt: new Date(),
      });

    await checkEndpoint(endpointFixture());

    expect(mockEndpointRecordFailure).toHaveBeenCalledWith(1, "endpoint-down");
    expect(mockEndpointMarkAutoDisabled).not.toHaveBeenCalledWith(1, expect.anything());
    expect(mockEmit).not.toHaveBeenCalledWith(
      "endpoint.disabled",
      expect.anything(),
      expect.anything(),
    );
  });

  it("auto-reenables a previously auto-disabled endpoint when ping succeeds", async () => {
    mockPingEndpoint.mockResolvedValue({ ok: true, status: 200, latencyMs: 15 });
    mockEndpointFindById.mockResolvedValue({
      id: 1,
      autoDisabled: true,
      consecutiveFailures: 3,
      lastFailureAt: new Date(),
    });

    await checkEndpoint(endpointFixture());

    expect(mockEndpointMarkAutoReenabled).toHaveBeenCalledWith(1);
    expect(mockEmit).toHaveBeenCalledWith(
      "endpoint.reenabled",
      null,
      expect.objectContaining({
        title: "Endpoint 已自动恢复: OpenAI",
        body: expect.stringContaining("连通性恢复正常"),
      }),
    );
    expect(mockEndpointRecordSuccess).not.toHaveBeenCalled();
  });
});
