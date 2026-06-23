import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindAnyEnabledByProvider = vi.fn();
const mockFindAnyEnabledByUpstream = vi.fn();
const mockFindEnabledModelsByProviderId = vi.fn();
const mockProviderUpdateHealth = vi.fn();
const mockProviderFindById = vi.fn();
const mockProviderRecordSuccess = vi.fn();
const mockProviderRecordFailure = vi.fn();
const mockProviderMarkAutoDisabled = vi.fn();
const mockProviderMarkAutoReenabled = vi.fn();
const mockUpstreamFindByIds = vi.fn();
const mockUpstreamFindById = vi.fn();
const mockUpstreamUpdateHealth = vi.fn();
const mockUpstreamRecordSuccess = vi.fn();
const mockUpstreamRecordFailure = vi.fn();
const mockUpstreamMarkAutoDisabled = vi.fn();
const mockUpstreamMarkAutoReenabled = vi.fn();
const mockFindAssignmentsByProviderId = vi.fn();
const mockPingEndpoint = vi.fn();
const mockEmit = vi.fn();
const mockEmitNotification = vi.fn();

vi.mock("@/server/events", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: (value: string) => `plain:${value}`,
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    supplier: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock("@/server/messaging/notifications", () => ({
  emitNotification: (...args: unknown[]) => mockEmitNotification(...args),
}));

vi.mock("@/server/repos", () => ({
  aiKeyRepo: {
    findAnyEnabledByProvider: (...args: unknown[]) => mockFindAnyEnabledByProvider(...args),
    findAnyEnabledByUpstream: (...args: unknown[]) => mockFindAnyEnabledByUpstream(...args),
  },
  aiModelRepo: {
    findEnabledByProviderId: (...args: unknown[]) => mockFindEnabledModelsByProviderId(...args),
  },
  aiProviderRepo: {
    updateHealth: (...args: unknown[]) => mockProviderUpdateHealth(...args),
    findById: (...args: unknown[]) => mockProviderFindById(...args),
    recordSuccess: (...args: unknown[]) => mockProviderRecordSuccess(...args),
    recordFailure: (...args: unknown[]) => mockProviderRecordFailure(...args),
    markAutoDisabled: (...args: unknown[]) => mockProviderMarkAutoDisabled(...args),
    markAutoReenabled: (...args: unknown[]) => mockProviderMarkAutoReenabled(...args),
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
}));

vi.mock("@/server/repos/ai-upstream-assignment-repo", () => ({
  aiUpstreamAssignmentRepo: {
    findByProviderId: (...args: unknown[]) => mockFindAssignmentsByProviderId(...args),
  },
}));

vi.mock("@/server/ai/lib/supplier-health", () => ({
  pingEndpoint: (...args: unknown[]) => mockPingEndpoint(...args),
}));

process.env.SUPPLIER_HEALTH_CHECK_FAILURE_THRESHOLD = "2";
process.env.SUPPLIER_HEALTH_CHECK_FAILURE_WINDOW_MS = "180000";

const { checkProvider } = await import("@/server/jobs/check-supplier-health");

function providerFixture() {
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

describe("supplier health job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPingEndpoint.mockResolvedValue({ ok: true, status: 200, latencyMs: 12 });
    mockProviderFindById.mockResolvedValue({
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
    mockFindAssignmentsByProviderId.mockResolvedValue([]);
    mockUpstreamFindByIds.mockResolvedValue([]);
    mockFindAnyEnabledByProvider.mockResolvedValue({ id: 100, encryptedKey: "provider-key" });
    mockFindAnyEnabledByUpstream.mockResolvedValue({ id: 101, encryptedKey: "upstream-key" });
    mockFindEnabledModelsByProviderId.mockResolvedValue([]);
  });

  it("checks upstreams with upstream-scoped keys even when the provider has no default key", async () => {
    mockFindAnyEnabledByProvider.mockResolvedValue(null);
    mockFindAnyEnabledByUpstream.mockImplementation(
      async (_providerId: number, upstreamId: number) =>
        upstreamId === 10
          ? { id: 101, encryptedKey: "upstream-10" }
          : { id: 102, encryptedKey: "upstream-11" },
    );
    mockFindAssignmentsByProviderId.mockResolvedValue([{ upstreamId: 10 }, { upstreamId: 11 }]);
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

    await checkProvider(providerFixture());

    expect(mockProviderUpdateHealth).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        healthStatus: "degraded",
        lastError: "No enabled API key configured",
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
    mockProviderFindById
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

    await checkProvider(providerFixture());

    expect(mockProviderRecordFailure).toHaveBeenCalledWith(1, "upstream-timeout");
    expect(mockProviderMarkAutoDisabled).not.toHaveBeenCalled();
    expect(mockEmitNotification).not.toHaveBeenCalled();
  });

  it("notifies on the second failed check within the 3 minute window", async () => {
    mockPingEndpoint.mockResolvedValue({
      ok: false,
      status: 503,
      error: "upstream-timeout",
      latencyMs: 10,
    });
    mockProviderFindById
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

    await checkProvider(providerFixture());

    expect(mockProviderMarkAutoDisabled).toHaveBeenCalledWith(1, "upstream-timeout");
    expect(mockEmitNotification).toHaveBeenCalledWith(
      "supplier.disabled",
      expect.objectContaining({
        title: "供应商已自动禁用: OpenAI",
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
    mockProviderFindById
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

    await checkProvider(providerFixture());

    expect(mockProviderUpdateHealth).toHaveBeenCalledWith(1, { consecutiveFailures: 0 });
    expect(mockProviderRecordFailure).toHaveBeenCalledWith(1, "upstream-timeout");
    expect(mockProviderMarkAutoDisabled).not.toHaveBeenCalled();
    expect(mockEmitNotification).not.toHaveBeenCalled();
  });
});
