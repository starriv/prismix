import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindProviderById = vi.fn();
const mockFindAnyEnabledByUpstream = vi.fn();
const mockFindModelsByProviderId = vi.fn();
const mockFindModelsByIds = vi.fn();
const mockFindAllModels = vi.fn();
const mockFindModelById = vi.fn();
const mockBatchCreateModels = vi.fn();
const mockBatchCreateRoutes = vi.fn();
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
    findAnyEnabledByProvider: vi.fn(),
    findAnyEnabledByUpstream: (...args: unknown[]) => mockFindAnyEnabledByUpstream(...args),
  },
  aiModelRepo: {
    findByProviderId: (...args: unknown[]) => mockFindModelsByProviderId(...args),
    findByModelIds: (...args: unknown[]) => mockFindModelsByIds(...args),
    findAll: (...args: unknown[]) => mockFindAllModels(...args),
    findById: (...args: unknown[]) => mockFindModelById(...args),
    findByProviderAndModelId: vi.fn(),
    create: vi.fn(),
    batchCreate: (...args: unknown[]) => mockBatchCreateModels(...args),
    deleteByIds: vi.fn(),
    updatePricesBatch: vi.fn(),
  },
  aiModelRouteRepo: {
    batchCreate: (...args: unknown[]) => mockBatchCreateRoutes(...args),
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
    mockFindAnyEnabledByUpstream.mockReset();
    mockFindModelsByProviderId.mockReset();
    mockFindModelsByIds.mockReset();
    mockFindAllModels.mockReset();
    mockFindModelById.mockReset();
    mockBatchCreateModels.mockReset();
    mockBatchCreateRoutes.mockReset();
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
    mockFindAllModels.mockResolvedValue([]);
    mockBatchCreateModels.mockResolvedValue([]);
    mockBatchCreateRoutes.mockResolvedValue([]);
    mockFindRoutesByModelPk.mockResolvedValue([]);
    mockFindModelById.mockResolvedValue({
      id: 42,
      providerId: 7,
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

  it("discovers models using the first upstream-scoped key", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
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

    const res = await app.request("http://localhost/providers/7/discover-models");
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

  it("returns 400 when no upstream candidate has a usable key", async () => {
    mockResolveUpstreamCandidates.mockResolvedValue([
      {
        id: 11,
        upstreamId: "friend-a",
        name: "Friend A",
        baseUrl: "https://friend-a.example.com",
      },
      {
        id: null,
        upstreamId: "legacy",
        name: "Anthropic Default",
        baseUrl: "https://api.anthropic.com",
      },
    ]);
    mockFindAnyEnabledByUpstream.mockResolvedValue(undefined);

    const res = await app.request("http://localhost/providers/7/discover-models");
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
