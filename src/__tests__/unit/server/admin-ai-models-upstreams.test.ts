import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindProviderById = vi.fn();
const mockFindAnyEnabledByProvider = vi.fn();
const mockFindAnyEnabledByUpstream = vi.fn();
const mockFindModelsByProviderId = vi.fn();
const mockFindModelsByIds = vi.fn();
const mockFindModelByModelId = vi.fn();
const mockFindAllModels = vi.fn();
const mockFindModelById = vi.fn();
const mockUpdateModel = vi.fn();
const mockBatchCreateModels = vi.fn();
const mockCreateRoute = vi.fn();
const mockBatchCreateRoutes = vi.fn();
const mockFindRouteByModelAndProvider = vi.fn();
const mockFindRoutesByModelPk = vi.fn();
const mockUpdateRouteForModel = vi.fn();
const mockDeleteRouteForModel = vi.fn();
const mockResolveUpstreamCandidates = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn().mockReturnValue({ adminId: 1 }),
}));

vi.mock("@/server/repos", () => ({
  aiKeyRepo: {
    findAnyEnabledByProvider: (...args: unknown[]) => mockFindAnyEnabledByProvider(...args),
    findAnyEnabledByUpstream: (...args: unknown[]) => mockFindAnyEnabledByUpstream(...args),
  },
  aiModelRepo: {
    findByProviderId: (...args: unknown[]) => mockFindModelsByProviderId(...args),
    findByModelIds: (...args: unknown[]) => mockFindModelsByIds(...args),
    findByModelId: (...args: unknown[]) => mockFindModelByModelId(...args),
    findAll: (...args: unknown[]) => mockFindAllModels(...args),
    findById: (...args: unknown[]) => mockFindModelById(...args),
    findByProviderAndModelId: vi.fn(),
    create: vi.fn(),
    update: (...args: unknown[]) => mockUpdateModel(...args),
    batchCreate: (...args: unknown[]) => mockBatchCreateModels(...args),
    deleteByIds: vi.fn(),
    updatePricesBatch: vi.fn(),
  },
  aiModelRouteRepo: {
    create: (...args: unknown[]) => mockCreateRoute(...args),
    batchCreate: (...args: unknown[]) => mockBatchCreateRoutes(...args),
    findByModelAndProvider: (...args: unknown[]) => mockFindRouteByModelAndProvider(...args),
    findByModelPk: (...args: unknown[]) => mockFindRoutesByModelPk(...args),
    updateForModel: (...args: unknown[]) => mockUpdateRouteForModel(...args),
    deleteForModel: (...args: unknown[]) => mockDeleteRouteForModel(...args),
  },
  aiProviderRepo: {
    findById: (...args: unknown[]) => mockFindProviderById(...args),
  },
}));

vi.mock("@/server/ai/lib/upstream-routing", () => ({
  resolveUpstreamCandidates: (...args: unknown[]) => mockResolveUpstreamCandidates(...args),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("plain-key"),
}));

vi.mock("@/server/ai/lib/litellm-pricing", () => ({
  isCatalogReady: vi.fn().mockReturnValue(false),
  lookupPricing: vi.fn().mockReturnValue(null),
  refreshLiteLLMPricing: vi.fn(),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-models");

const app = new Hono();
app.route("/", router);

describe("admin ai model discovery with upstream-scoped keys", () => {
  beforeEach(() => {
    mockFindProviderById.mockReset();
    mockFindAnyEnabledByProvider.mockReset();
    mockFindAnyEnabledByUpstream.mockReset();
    mockFindModelsByProviderId.mockReset();
    mockFindModelsByIds.mockReset();
    mockFindModelByModelId.mockReset();
    mockFindAllModels.mockReset();
    mockFindModelById.mockReset();
    mockUpdateModel.mockReset();
    mockBatchCreateModels.mockReset();
    mockCreateRoute.mockReset();
    mockBatchCreateRoutes.mockReset();
    mockFindRouteByModelAndProvider.mockReset();
    mockFindRoutesByModelPk.mockReset();
    mockUpdateRouteForModel.mockReset();
    mockDeleteRouteForModel.mockReset();
    mockResolveUpstreamCandidates.mockReset();
    mockFetch.mockReset();

    mockFindProviderById.mockResolvedValue({
      id: 7,
      providerId: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiFormat: "anthropic",
      authType: "api-key",
      authConfig: JSON.stringify({ headerName: "x-api-key" }),
      enabled: true,
    });
    mockFindModelsByProviderId.mockResolvedValue([]);
    mockFindModelsByIds.mockResolvedValue([]);
    mockFindModelByModelId.mockResolvedValue(undefined);
    mockFindAllModels.mockResolvedValue([]);
    mockUpdateModel.mockImplementation((_: number, data: Record<string, unknown>) =>
      Promise.resolve({
        id: 42,
        providerId: 7,
        clientFormat: data.clientFormat ?? "openai",
        modelId: "gpt-4o",
        name: data.name ?? "GPT-4o",
        contextWindow: 128000,
        inputPrice: "5",
        outputPrice: "15",
        capabilities: JSON.stringify(data.capabilities ?? []),
        fallbackModelIds: null,
        weight: 1,
        enabled: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );
    mockBatchCreateModels.mockResolvedValue([]);
    mockCreateRoute.mockResolvedValue({ id: 10, modelId: 42, providerId: 7 });
    mockBatchCreateRoutes.mockResolvedValue([]);
    mockFindRouteByModelAndProvider.mockResolvedValue(undefined);
    mockFindRoutesByModelPk.mockResolvedValue([]);
    mockFindModelById.mockResolvedValue({
      id: 42,
      providerId: 7,
      clientFormat: "openai",
      modelId: "gpt-4o",
      name: "GPT-4o",
      contextWindow: 128000,
      inputPrice: "5",
      outputPrice: "15",
      capabilities: "[]",
      fallbackModelIds: null,
      weight: 1,
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("discovers models using the official key by default", async () => {
    mockFindAnyEnabledByProvider.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: null,
      encryptedKey: "encrypted",
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await app.request("http://localhost/providers/7/discover-models");
    const json = (await res.json()) as {
      data: Array<{ modelId: string; name: string; registered: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(mockFindAnyEnabledByProvider).toHaveBeenCalledWith(7);
    expect(mockResolveUpstreamCandidates).not.toHaveBeenCalled();
    expect(mockFindAnyEnabledByUpstream).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.anthropic.com/models");
    expect(json.data[0]).toMatchObject({
      modelId: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      registered: false,
    });
  });

  it("discovers models using the first upstream-scoped key when source=upstream", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
        modelsEndpoint: null,
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: 11,
      encryptedKey: "encrypted",
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await app.request("http://localhost/providers/7/discover-models?source=upstream");
    const json = (await res.json()) as {
      data: Array<{ modelId: string; name: string; registered: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(mockFindAnyEnabledByUpstream).toHaveBeenCalledWith(7, 11);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/models");
    expect(json.data[0]).toMatchObject({
      modelId: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      registered: false,
    });
  });

  it("uses upstream modelsEndpoint when set instead of apiFormat-based URL", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "proxy-a",
        name: "Proxy A",
        baseUrl: "https://proxy-a.example.com",
        modelsEndpoint: "https://proxy-a.example.com/v1/models",
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: 11,
      encryptedKey: "encrypted",
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await app.request("http://localhost/providers/7/discover-models?source=upstream");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Should use the custom modelsEndpoint, not {base}/models from anthropic format
    expect(mockFetch.mock.calls[0][0]).toBe("https://proxy-a.example.com/v1/models");
  });

  it("discovers models through a Cloudflare Access protected upstream", async () => {
    mockFindProviderById.mockResolvedValue({
      id: 7,
      providerId: "glm",
      name: "GLM",
      baseUrl: "https://official.example.com/v1",
      apiFormat: "openai",
      authType: "cloudflare",
      authConfig: JSON.stringify({ clientId: "service-token.access" }),
      enabled: true,
    });
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "glm-cf",
        name: "GLM Cloudflare",
        baseUrl: "https://class-1-violations.example.com/v1",
        modelsEndpoint: null,
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: 11,
      encryptedKey: "encrypted",
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "glm-5.2", name: "GLM 5.2" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await app.request("http://localhost/providers/7/discover-models?source=upstream");

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://class-1-violations.example.com/v1/models");
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      "CF-Access-Client-Id": "service-token.access",
      "CF-Access-Client-Secret": "plain-key",
    });
  });

  it("scopes discovered registered flags by requested clientFormat", async () => {
    mockFindProviderById.mockResolvedValue({
      id: 7,
      providerId: "glm",
      name: "GLM",
      baseUrl: "https://official.example.com/v1",
      apiFormat: "openai",
      authType: "bearer",
      authConfig: JSON.stringify({}),
      enabled: true,
    });
    mockFindAnyEnabledByProvider.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: null,
      encryptedKey: "encrypted",
    });
    mockFindModelsByProviderId.mockResolvedValue([
      {
        id: 99,
        providerId: 7,
        clientFormat: "openai",
        modelId: "glm-5.2",
        name: "GLM 5.2 OpenAI",
        contextWindow: null,
        inputPrice: "1",
        outputPrice: "2",
        capabilities: "[]",
        fallbackModelIds: null,
        weight: 1,
        enabled: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "glm-5.2", name: "GLM 5.2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await app.request(
      "http://localhost/providers/7/discover-models?clientFormat=anthropic",
    );
    const json = (await res.json()) as {
      data: Array<{ modelId: string; registered: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(json.data[0]).toMatchObject({ modelId: "glm-5.2", registered: false });
  });

  it("falls back to apiFormat URL when modelsEndpoint is null", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
        modelsEndpoint: null,
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue({
      id: 123,
      providerId: 7,
      upstreamId: 11,
      encryptedKey: "encrypted",
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await app.request("http://localhost/providers/7/discover-models?source=upstream");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Should fall back to anthropic format: {base}/models
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/models");
  });

  it("returns 400 when official discovery has no usable key", async () => {
    mockFindAnyEnabledByProvider.mockResolvedValue(undefined);

    const res = await app.request("http://localhost/providers/7/discover-models");
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("No API key configured");
    expect(mockResolveUpstreamCandidates).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when no upstream candidate has a usable key", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
        modelsEndpoint: null,
      },
      {
        id: null,
        upstreamId: "legacy",
        name: "Anthropic Default",
        baseUrl: "https://api.anthropic.com",
        modelsEndpoint: null,
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue(undefined);

    const res = await app.request("http://localhost/providers/7/discover-models?source=upstream");
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("No API key configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("flat models list includes disabled or unrouted models", async () => {
    mockFindAllModels.mockResolvedValue([
      {
        id: 42,
        providerId: null,
        clientFormat: "openai",
        modelId: "gpt-4o",
        name: "GPT-4o",
        contextWindow: 128000,
        inputPrice: "5",
        outputPrice: "15",
        capabilities: "[]",
        fallbackModelIds: null,
        weight: 1,
        enabled: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await app.request("http://localhost/models");
    const json = (await res.json()) as {
      data: Array<{ id: number; routes: unknown[]; enabled: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(mockFindAllModels).toHaveBeenCalledTimes(1);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({ id: 42, enabled: false, routes: [] });
  });

  it("batch create links existing models to the new provider", async () => {
    mockFindModelsByIds.mockResolvedValue([
      {
        id: 99,
        providerId: 3,
        clientFormat: "anthropic",
        modelId: "gpt-4o",
        name: "GPT-4o",
        contextWindow: 128000,
        inputPrice: "5",
        outputPrice: "15",
        capabilities: "[]",
        fallbackModelIds: null,
        weight: 1,
        enabled: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    mockBatchCreateRoutes.mockResolvedValue([{ id: 1 }]);

    const res = await app.request("http://localhost/providers/7/models/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: [{ modelId: "gpt-4o", name: "GPT-4o" }],
      }),
    });
    const json = (await res.json()) as { data: { created: number; linked: number } };

    expect(res.status).toBe(201);
    expect(mockBatchCreateModels).toHaveBeenCalledWith([]);
    expect(mockBatchCreateRoutes).toHaveBeenCalledWith([{ modelId: 99, providerId: 7 }]);
    expect(json.data).toMatchObject({ created: 0, linked: 1 });
  });

  it("scopes route updates to the nested model id", async () => {
    mockUpdateRouteForModel.mockResolvedValue({
      id: 7,
      modelId: 42,
      providerId: 7,
      priority: 200,
      weight: 1,
      enabled: true,
      providerModelId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await app.request("http://localhost/models/42/routes/7", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: 200 }),
    });

    expect(res.status).toBe(200);
    expect(mockUpdateRouteForModel).toHaveBeenCalledWith(42, 7, { priority: 200 });
  });

  it("allows an Anthropic model route to an OpenAI-format provider", async () => {
    mockFindModelById.mockResolvedValue({
      id: 42,
      providerId: 7,
      clientFormat: "anthropic",
      modelId: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      contextWindow: 200000,
      inputPrice: "3",
      outputPrice: "15",
      capabilities: "[]",
      fallbackModelIds: null,
      weight: 1,
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mockFindProviderById.mockResolvedValue({
      id: 7,
      providerId: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiFormat: "openai",
      authType: "bearer",
      authConfig: JSON.stringify({}),
      enabled: true,
    });

    const res = await app.request("http://localhost/models/42/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: 7 }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateRoute).toHaveBeenCalledWith({ modelId: 42, providerId: 7 });
  });

  it("rejects an Anthropic model route to an unsupported provider format", async () => {
    mockFindModelById.mockResolvedValue({
      id: 42,
      providerId: 7,
      clientFormat: "anthropic",
      modelId: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      contextWindow: 200000,
      inputPrice: "3",
      outputPrice: "15",
      capabilities: "[]",
      fallbackModelIds: null,
      weight: 1,
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mockFindProviderById.mockResolvedValue({
      id: 7,
      providerId: "google",
      name: "Google AI",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiFormat: "gemini",
      authType: "bearer",
      authConfig: JSON.stringify({}),
      enabled: true,
    });

    const res = await app.request("http://localhost/models/42/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: 7 }),
    });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("not compatible with anthropic models");
  });

  it("rejects changing a model to a client format where the same model id already exists", async () => {
    mockFindModelByModelId.mockResolvedValue({
      id: 99,
      providerId: 8,
      clientFormat: "anthropic",
      modelId: "gpt-4o",
      name: "GPT-4o Anthropic",
      contextWindow: 128000,
      inputPrice: "5",
      outputPrice: "15",
      capabilities: "[]",
      fallbackModelIds: null,
      weight: 1,
      enabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await app.request("http://localhost/models/42", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientFormat: "anthropic" }),
    });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(json.error).toContain('Model "gpt-4o" already exists for anthropic');
    expect(mockUpdateModel).not.toHaveBeenCalled();
  });

  it("returns 404 when the nested route does not belong to the model", async () => {
    mockDeleteRouteForModel.mockResolvedValue(false);

    const res = await app.request("http://localhost/models/42/routes/7", {
      method: "DELETE",
    });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(404);
    expect(mockDeleteRouteForModel).toHaveBeenCalledWith(42, 7);
    expect(json.error).toBe("Route not found");
  });
});
