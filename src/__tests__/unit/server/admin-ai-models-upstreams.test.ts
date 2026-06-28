import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEndpointById = vi.fn();
const mockFindAnyEnabledCredentialBySupplier = vi.fn();
const mockFindAnyEnabledByEndpoint = vi.fn();
const mockFindAnyEnabledByUpstream = vi.fn();
const mockFindModelsByEndpointId = vi.fn();
const mockFindModelsByIds = vi.fn();
const mockFindModelByModelId = vi.fn();
const mockFindAllModels = vi.fn();
const mockFindModelById = vi.fn();
const mockUpdateModel = vi.fn();
const mockBatchCreateModels = vi.fn();
const mockFindGrayUsersByModelId = vi.fn();
const mockFindGrayUsersByModelIds = vi.fn();
const mockReplaceGrayUsersForModel = vi.fn();
const mockCreateRoute = vi.fn();
const mockBatchCreateRoutes = vi.fn();
const mockFindRouteByModelAndEndpoint = vi.fn();
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
  aiCredentialRepo: {
    findAnyEnabledBySupplierId: (...args: unknown[]) =>
      mockFindAnyEnabledCredentialBySupplier(...args),
  },
  aiEndpointCredentialRepo: {
    findAnyEnabledByEndpoint: (...args: unknown[]) => mockFindAnyEnabledByEndpoint(...args),
    findAnyEnabledByUpstream: (...args: unknown[]) => mockFindAnyEnabledByUpstream(...args),
  },
  aiModelRepo: {
    findByEndpointId: (...args: unknown[]) => mockFindModelsByEndpointId(...args),
    findByModelIds: (...args: unknown[]) => mockFindModelsByIds(...args),
    findByModelId: (...args: unknown[]) => mockFindModelByModelId(...args),
    findAll: (...args: unknown[]) => mockFindAllModels(...args),
    findById: (...args: unknown[]) => mockFindModelById(...args),
    findByEndpointAndModelId: vi.fn(),
    create: vi.fn(),
    update: (...args: unknown[]) => mockUpdateModel(...args),
    batchCreate: (...args: unknown[]) => mockBatchCreateModels(...args),
    batchDelete: vi.fn(),
    batchUpdatePrices: vi.fn(),
  },
  aiModelGrayUserRepo: {
    findUsersByModelId: (...args: unknown[]) => mockFindGrayUsersByModelId(...args),
    findUsersByModelIds: (...args: unknown[]) => mockFindGrayUsersByModelIds(...args),
    replaceForModel: (...args: unknown[]) => mockReplaceGrayUsersForModel(...args),
  },
  aiModelRouteRepo: {
    create: (...args: unknown[]) => mockCreateRoute(...args),
    batchCreate: (...args: unknown[]) => mockBatchCreateRoutes(...args),
    findByModelAndEndpoint: (...args: unknown[]) => mockFindRouteByModelAndEndpoint(...args),
    findByModelPk: (...args: unknown[]) => mockFindRoutesByModelPk(...args),
    updateForModel: (...args: unknown[]) => mockUpdateRouteForModel(...args),
    deleteForModel: (...args: unknown[]) => mockDeleteRouteForModel(...args),
  },
  aiEndpointRepo: {
    findById: (...args: unknown[]) => mockFindEndpointById(...args),
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

describe("admin ai model discovery with upstream-scoped credentials", () => {
  beforeEach(() => {
    mockFindEndpointById.mockReset();
    mockFindAnyEnabledCredentialBySupplier.mockReset();
    mockFindAnyEnabledByEndpoint.mockReset();
    mockFindAnyEnabledByUpstream.mockReset();
    mockFindModelsByEndpointId.mockReset();
    mockFindModelsByIds.mockReset();
    mockFindModelByModelId.mockReset();
    mockFindAllModels.mockReset();
    mockFindModelById.mockReset();
    mockUpdateModel.mockReset();
    mockBatchCreateModels.mockReset();
    mockFindGrayUsersByModelId.mockReset();
    mockFindGrayUsersByModelIds.mockReset();
    mockReplaceGrayUsersForModel.mockReset();
    mockCreateRoute.mockReset();
    mockBatchCreateRoutes.mockReset();
    mockFindRouteByModelAndEndpoint.mockReset();
    mockFindRoutesByModelPk.mockReset();
    mockUpdateRouteForModel.mockReset();
    mockDeleteRouteForModel.mockReset();
    mockResolveUpstreamCandidates.mockReset();
    mockFetch.mockReset();

    mockFindEndpointById.mockResolvedValue({
      id: 7,
      supplierId: 5,
      endpointId: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiFormat: "anthropic",
      authType: "api-key",
      authConfig: JSON.stringify({ headerName: "x-api-key" }),
      enabled: true,
    });
    mockFindModelsByEndpointId.mockResolvedValue([]);
    mockFindAnyEnabledCredentialBySupplier.mockResolvedValue(undefined);
    mockFindModelsByIds.mockResolvedValue([]);
    mockFindModelByModelId.mockResolvedValue(undefined);
    mockFindAllModels.mockResolvedValue([]);
    mockUpdateModel.mockImplementation((_: number, data: Record<string, unknown>) =>
      Promise.resolve({
        id: 42,
        endpointId: 7,
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
    mockFindGrayUsersByModelId.mockResolvedValue([]);
    mockFindGrayUsersByModelIds.mockResolvedValue(new Map());
    mockReplaceGrayUsersForModel.mockResolvedValue(undefined);
    mockCreateRoute.mockResolvedValue({ id: 10, modelId: 42, endpointId: 7 });
    mockBatchCreateRoutes.mockResolvedValue([]);
    mockFindRouteByModelAndEndpoint.mockResolvedValue(undefined);
    mockFindRoutesByModelPk.mockResolvedValue([]);
    mockFindModelById.mockResolvedValue({
      id: 42,
      endpointId: 7,
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

  it("discovers models using the official endpoint credential by default", async () => {
    mockFindAnyEnabledByEndpoint.mockResolvedValue({
      id: 123,
      endpointId: 7,
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

    const res = await app.request("http://localhost/endpoints/7/discover-models");
    const json = (await res.json()) as {
      data: Array<{ modelId: string; name: string; registered: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(mockFindAnyEnabledByEndpoint).toHaveBeenCalledWith(7);
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

  it("discovers official models with a reusable supplier credential when the endpoint pool is empty", async () => {
    mockFindEndpointById.mockResolvedValue({
      id: 7,
      supplierId: 5,
      endpointId: "deepseek-openai",
      name: "DeepSeek OpenAI",
      baseUrl: "https://api.deepseek.com",
      apiFormat: "openai",
      authType: "bearer",
      authConfig: "{}",
      enabled: true,
    });
    mockFindAnyEnabledByEndpoint.mockResolvedValue(undefined);
    mockFindAnyEnabledCredentialBySupplier.mockResolvedValue({
      id: 100,
      supplierId: 5,
      encryptedKey: "encrypted",
      enabled: true,
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await app.request("http://localhost/endpoints/7/discover-models");
    const json = (await res.json()) as {
      data: Array<{ modelId: string; name: string; registered: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(mockFindAnyEnabledByEndpoint).toHaveBeenCalledWith(7);
    expect(mockFindAnyEnabledCredentialBySupplier).toHaveBeenCalledWith(5);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer plain-key",
    });
    expect(json.data[0]).toMatchObject({
      modelId: "deepseek-chat",
      name: "DeepSeek Chat",
      registered: false,
    });
  });

  it("discovers models using the first upstream-scoped credential when source=upstream", async () => {
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
      endpointId: 7,
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

    const res = await app.request("http://localhost/endpoints/7/discover-models?source=upstream");
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
      endpointId: 7,
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

    const res = await app.request("http://localhost/endpoints/7/discover-models?source=upstream");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Should use the custom modelsEndpoint, not {base}/models from anthropic format
    expect(mockFetch.mock.calls[0][0]).toBe("https://proxy-a.example.com/v1/models");
  });

  it("discovers models through a Cloudflare Access protected upstream", async () => {
    mockFindEndpointById.mockResolvedValue({
      id: 7,
      endpointId: "glm",
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
      endpointId: 7,
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

    const res = await app.request("http://localhost/endpoints/7/discover-models?source=upstream");

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://class-1-violations.example.com/v1/models");
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      "CF-Access-Client-Id": "service-token.access",
      "CF-Access-Client-Secret": "plain-key",
    });
  });

  it("marks discovered models registered by model id", async () => {
    mockFindEndpointById.mockResolvedValue({
      id: 7,
      endpointId: "glm",
      name: "GLM",
      baseUrl: "https://official.example.com/v1",
      apiFormat: "openai",
      authType: "bearer",
      authConfig: JSON.stringify({}),
      enabled: true,
    });
    mockFindAnyEnabledByEndpoint.mockResolvedValue({
      id: 123,
      endpointId: 7,
      upstreamId: null,
      encryptedKey: "encrypted",
    });
    mockFindModelsByEndpointId.mockResolvedValue([
      {
        id: 99,
        endpointId: 7,
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

    const res = await app.request("http://localhost/endpoints/7/discover-models");
    const json = (await res.json()) as {
      data: Array<{ modelId: string; registered: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(json.data[0]).toMatchObject({ modelId: "glm-5.2", registered: true });
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
      endpointId: 7,
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

    const res = await app.request("http://localhost/endpoints/7/discover-models?source=upstream");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Should fall back to anthropic format: {base}/models
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/models");
  });

  it("returns 400 when official discovery has no usable credential", async () => {
    mockFindAnyEnabledByEndpoint.mockResolvedValue(undefined);

    const res = await app.request("http://localhost/endpoints/7/discover-models");
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("No credential configured");
    expect(mockResolveUpstreamCandidates).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when no upstream candidate has a usable credential", async () => {
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
        upstreamId: "default-anthropic",
        name: "Anthropic Default",
        baseUrl: "https://api.anthropic.com",
        modelsEndpoint: null,
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue(undefined);

    const res = await app.request("http://localhost/endpoints/7/discover-models?source=upstream");
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("No credential configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("flat models list includes disabled or unrouted models", async () => {
    mockFindAllModels.mockResolvedValue([
      {
        id: 42,
        endpointId: null,
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

  it("batch create links existing models to the new endpoint", async () => {
    mockFindModelsByIds.mockResolvedValue([
      {
        id: 99,
        endpointId: 3,
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

    const res = await app.request("http://localhost/endpoints/7/models/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: [{ modelId: "gpt-4o", name: "GPT-4o" }],
      }),
    });
    const json = (await res.json()) as { data: { created: number; linked: number } };

    expect(res.status).toBe(201);
    expect(mockBatchCreateModels).toHaveBeenCalledWith([]);
    expect(mockBatchCreateRoutes).toHaveBeenCalledWith([{ modelId: 99, endpointId: 7 }]);
    expect(json.data).toMatchObject({ created: 0, linked: 1 });
  });

  it("scopes route updates to the nested model id", async () => {
    mockUpdateRouteForModel.mockResolvedValue({
      id: 7,
      modelId: 42,
      endpointId: 7,
      priority: 200,
      weight: 1,
      enabled: true,
      endpointModelId: null,
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

  it("allows a model route to any supplier connection format", async () => {
    mockFindModelById.mockResolvedValue({
      id: 42,
      endpointId: 7,
      modelId: "glm-5.2",
      name: "GLM 5.2",
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
    mockFindEndpointById.mockResolvedValue({
      id: 7,
      endpointId: "google",
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
      body: JSON.stringify({ endpointId: 7 }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateRoute).toHaveBeenCalledWith({ modelId: 42, endpointId: 7 });
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
