import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEnabledByModelId = vi.fn();
const mockResolveUpstreamCandidates = vi.fn();
const mockResolveModelMapping = vi.fn();
const mockPickKey = vi.fn();
const mockDecrypt = vi.fn();
const mockFetch = vi.fn();
const mockBillConsumer = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/server/ai/middleware/consumer-key-auth", () => ({
  getConsumerSession: vi.fn().mockReturnValue({
    consumerId: 1,
    userId: 10,
    agentId: 100,
    markupPercent: 0,
    allowedModels: [],
    perPayLimit: null,
    dailyLimit: null,
    monthlyLimit: null,
  }),
}));

vi.mock("@/server/middleware/request-id", () => ({
  getRequestId: vi.fn().mockReturnValue("req-test"),
}));

vi.mock("@/server/repos", () => ({
  aiGuardrailConfigRepo: { findAllEnabled: vi.fn().mockResolvedValue([]) },
  aiModelRepo: {
    findEnabledByModelId: (...args: unknown[]) => mockFindEnabledByModelId(...args),
  },
  aiModelRouteRepo: {
    findEnabledRoutesByModelId: vi.fn(),
  },
  payAgentRepo: {
    findById: vi.fn(),
  },
  payAgentTransactionRepo: {
    sumSpendingToday: vi.fn(),
    sumSpendingThisMonth: vi.fn(),
  },
}));

vi.mock("@/server/ai/lib/upstream-routing", () => ({
  MAX_UPSTREAM_ATTEMPTS: 5,
  resolveUpstreamCandidates: (...args: unknown[]) => mockResolveUpstreamCandidates(...args),
}));

vi.mock("@/server/ai/lib/model-mapping-cache", () => ({
  resolveModelMapping: (...args: unknown[]) => mockResolveModelMapping(...args),
}));

vi.mock("@/server/ai/lib/key-balancer", () => ({
  pickKey: (...args: unknown[]) => mockPickKey(...args),
  markKeyFailure: vi.fn(),
  markKeySuccess: vi.fn(),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

vi.mock("@/server/ai/lib/billing", () => ({
  billConsumer: (...args: unknown[]) => mockBillConsumer(...args),
  calculateConsumerCost: vi.fn(),
}));

vi.mock("@/server/lib/gateway-config", () => ({
  getGatewayConfigCached: vi.fn().mockReturnValue({ timeouts: {} }),
  resolveTimeoutConfig: vi.fn().mockReturnValue({
    upstreamFetchMs: 15_000,
    streamMaxDurationMs: 60_000,
    upstreamFetchOverrides: [],
  }),
  resolveUpstreamFetchTimeoutMs: vi.fn().mockReturnValue(15_000),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock("@/server/lib/metrics", () => ({
  gatewayUpstreamDuration: { observe: vi.fn() },
}));

vi.mock("@/server/ai/lib/request-helpers", () => ({
  extractPassthroughHeaders: vi.fn().mockReturnValue({}),
  isRequestLoggingEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/server/ai/lib/access-log", () => ({
  buildAccessLogErrorMessage: vi.fn(),
  enqueueAiAccessLog: vi.fn(),
}));

vi.mock("@/server/ai/lib/stream-proxy", () => ({
  RETRYABLE_STATUS: new Set([408, 429, 500, 502, 503, 504]),
  extractPassthroughUsage: vi.fn().mockReturnValue(null),
  fetchUpstream: vi.fn(),
  forwardPassthroughStream: vi.fn(),
  forwardStream: vi.fn(),
}));

const { default: consumerRelay } = await import("@/server/ai/routes/consumer-relay");

const app = new Hono();
app.route("/", consumerRelay);

describe("consumer relay passthrough upstream routing", () => {
  beforeEach(() => {
    mockFindEnabledByModelId.mockReset();
    mockResolveUpstreamCandidates.mockReset();
    mockResolveModelMapping.mockReset();
    mockPickKey.mockReset();
    mockDecrypt.mockReset();
    mockFetch.mockReset();
    mockBillConsumer.mockReset();

    mockFindEnabledByModelId.mockResolvedValue({
      model: {
        id: 101,
        providerId: 7,
        modelId: "claude-sonnet-4",
        inputPrice: "3",
        outputPrice: "15",
        enabled: true,
      },
      provider: {
        id: 7,
        providerId: "anthropic",
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        apiFormat: "anthropic",
        authType: "api-key",
        authConfig: JSON.stringify({ headerName: "x-api-key" }),
        enabled: true,
      },
    });
    mockResolveModelMapping.mockImplementation(
      async (_upstreamId: number | null, modelId: string) => modelId,
    );
    mockDecrypt.mockReturnValue("plain-key");
  });

  it("remaps the passthrough model ID per upstream before forwarding", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
      },
    ]);
    mockPickKey.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: 11,
      encryptedKey: "encrypted",
      name: "friend-key",
    });
    mockResolveModelMapping.mockResolvedValue("kiro/opus04.7");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await app.request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4", stream: false }),
    });

    expect(res.status).toBe(200);
    expect(mockResolveModelMapping).toHaveBeenCalledWith(11, "claude-sonnet-4");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body)).model).toBe("kiro/opus04.7");
  });
});
