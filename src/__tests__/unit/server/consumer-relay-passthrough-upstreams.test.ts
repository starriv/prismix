import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEnabledRoutesByModelId = vi.fn();
const mockResolveUpstreamCandidates = vi.fn();
const mockResolveModelMapping = vi.fn();
const mockPickKey = vi.fn();
const mockDecrypt = vi.fn();
const mockFetch = vi.fn();
const mockBillConsumer = vi.fn();
const mockGatewayError = vi.fn();

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
    findAllEnabled: vi.fn().mockResolvedValue([]),
  },
  aiModelRouteRepo: {
    findEnabledRoutesByModelId: (...args: unknown[]) => mockFindEnabledRoutesByModelId(...args),
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
  checkConsumerSpendingLimits: vi.fn().mockResolvedValue(null),
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
    gateway: {
      info: vi.fn(),
      warn: vi.fn(),
      error: (...args: unknown[]) => mockGatewayError(...args),
    },
  },
}));

vi.mock("@/server/lib/metrics", () => ({
  gatewayUpstreamDuration: { observe: vi.fn() },
}));

vi.mock("@/server/ai/lib/request-helpers", () => ({
  extractPassthroughHeaders: vi.fn().mockReturnValue({}),
  isRequestLoggingEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/server/ai/lib/semantic-cache", () => ({
  buildCacheKey: vi.fn().mockReturnValue("cache-key"),
  getCachedResponse: vi.fn().mockReturnValue(null),
  setCachedResponse: vi.fn(),
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

const { anthropicAdapter } = await import("@/server/ai/providers/anthropic");
const { openaiAdapter } = await import("@/server/ai/providers/openai");
const { registerAdapter } = await import("@/server/ai/providers/registry");
registerAdapter(anthropicAdapter);
registerAdapter(openaiAdapter);
const { consumerAnthropicRelayRouter } = await import("@/server/ai/routes/consumer-relay");

const app = new Hono();
app.route("/", consumerAnthropicRelayRouter);

describe("consumer relay Anthropic client protocol routing", () => {
  beforeEach(() => {
    mockFindEnabledRoutesByModelId.mockReset();
    mockResolveUpstreamCandidates.mockReset();
    mockResolveModelMapping.mockReset();
    mockPickKey.mockReset();
    mockDecrypt.mockReset();
    mockFetch.mockReset();
    mockBillConsumer.mockReset();
    mockBillConsumer.mockResolvedValue({ ok: true, upstreamCost: "0", costStr: "0" });

    mockFindEnabledRoutesByModelId.mockResolvedValue([
      {
        route: {
          id: 201,
          modelId: 101,
          providerId: 7,
          providerModelId: null,
          priority: 100,
          weight: 1,
          enabled: true,
        },
        model: {
          id: 101,
          providerId: 7,
          clientFormat: "anthropic",
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
      },
    ]);
    mockResolveModelMapping.mockImplementation(
      async (_upstreamId: number | null, modelId: string) => modelId,
    );
    mockDecrypt.mockReturnValue("plain-key");
  });

  it("remaps the model ID before forwarding to a native Anthropic upstream", async () => {
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
      new Response(
        JSON.stringify({
          id: "msg_upstream",
          type: "message",
          role: "assistant",
          model: "kiro/opus04.7",
          content: [{ type: "text", text: "hello" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res = await app.request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      }),
    });
    const json = (await res.json()) as { model: string; content: Array<{ text: string }> };

    expect(res.status).toBe(200);
    expect(mockResolveModelMapping).toHaveBeenCalledWith(11, "claude-sonnet-4");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/v1/messages");
    expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body)).model).toBe("kiro/opus04.7");
    expect(json).toMatchObject({
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("accepts a trailing slash on the Anthropic messages route", async () => {
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
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_upstream",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4",
          content: [{ type: "text", text: "hello" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res = await app.request("http://localhost/v1/messages/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/v1/messages");
  });

  it("converts Anthropic messages to OpenAI chat completions for an OpenAI upstream", async () => {
    mockFindEnabledRoutesByModelId.mockResolvedValue([
      {
        route: {
          id: 201,
          modelId: 101,
          providerId: 7,
          providerModelId: "glm-5.2",
          priority: 100,
          weight: 1,
          enabled: true,
        },
        model: {
          id: 101,
          providerId: 7,
          clientFormat: "anthropic",
          modelId: "claude-glm",
          inputPrice: "1",
          outputPrice: "2",
          enabled: true,
        },
        provider: {
          id: 7,
          providerId: "glm",
          name: "GLM",
          baseUrl: "https://glm.example.com/v1",
          apiFormat: "openai",
          authType: "bearer",
          authConfig: JSON.stringify({}),
          enabled: true,
        },
      },
    ]);
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "glm-cf",
        name: "GLM CF",
        baseUrl: "https://glm.example.com/v1",
      },
    ]);
    mockPickKey.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: 11,
      encryptedKey: "encrypted",
      name: "glm-key",
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "你好" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const res = await app.request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-glm",
        system: "You are concise.",
        messages: [{ role: "user", content: "你好" }],
        max_tokens: 512,
      }),
    });
    const json = (await res.json()) as {
      type: string;
      model: string;
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    expect(res.status).toBe(200);
    expect(mockFindEnabledRoutesByModelId).toHaveBeenCalledWith("claude-glm", "anthropic");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://glm.example.com/v1/chat/completions");
    const upstreamBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(upstreamBody).toMatchObject({
      model: "glm-5.2",
      max_tokens: 512,
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "你好" },
      ],
    });
    expect(json).toMatchObject({
      type: "message",
      model: "claude-glm",
      content: [{ type: "text", text: "你好" }],
      usage: { input_tokens: 8, output_tokens: 3 },
    });
  });

  it("estimates Anthropic count_tokens locally for a compatible OpenAI upstream route", async () => {
    mockFindEnabledRoutesByModelId.mockResolvedValue([
      {
        route: {
          id: 201,
          modelId: 101,
          providerId: 7,
          providerModelId: "glm-5.2",
          priority: 100,
          weight: 1,
          enabled: true,
        },
        model: {
          id: 101,
          providerId: 7,
          clientFormat: "anthropic",
          modelId: "claude-glm",
          inputPrice: "1",
          outputPrice: "2",
          enabled: true,
        },
        provider: {
          id: 7,
          providerId: "glm",
          name: "GLM",
          baseUrl: "https://glm.example.com/v1",
          apiFormat: "openai",
          authType: "cloudflare",
          authConfig: JSON.stringify({ clientId: "client-id.access" }),
          enabled: true,
        },
      },
    ]);

    const res = await app.request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-glm",
        system: "You are concise.",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    const json = (await res.json()) as { input_tokens: number };

    expect(res.status).toBe(200);
    expect(json.input_tokens).toBeGreaterThan(0);
    expect(mockFindEnabledRoutesByModelId).toHaveBeenCalledWith("claude-glm", "anthropic");
    expect(mockResolveUpstreamCandidates).not.toHaveBeenCalled();
    expect(mockPickKey).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
