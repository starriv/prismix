import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindProviderById = vi.fn();
const mockFindAnyEnabledByUpstream = vi.fn();
const mockFindModelsByProviderId = vi.fn();
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
    findByProviderAndModelId: vi.fn(),
    create: vi.fn(),
    batchCreate: vi.fn(),
    deleteByIds: vi.fn(),
    updatePricesBatch: vi.fn(),
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
});
