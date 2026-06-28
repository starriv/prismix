import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEndpointCredentialById = vi.fn();
const mockUpdateLastUsed = vi.fn();
const mockFindEndpointById = vi.fn();
const mockFindUpstreamById = vi.fn();
const mockFindEndpointUpstreamAssignment = vi.fn();
const mockFindEnabledModelsByEndpointId = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/server/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn().mockReturnValue({ adminId: 1 }),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("plain-key"),
  encrypt: vi.fn(),
  hashApiKey: vi.fn(),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock("@/server/ai/lib/credential-balancer", () => ({
  invalidateCredentialPool: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiEndpointCredentialRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: (...args: unknown[]) => mockFindEndpointCredentialById(...args),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateLastUsed: (...args: unknown[]) => mockUpdateLastUsed(...args),
  },
  aiModelRepo: {
    findEnabledByEndpointId: (...args: unknown[]) => mockFindEnabledModelsByEndpointId(...args),
  },
  aiEndpointRepo: {
    findById: (...args: unknown[]) => mockFindEndpointById(...args),
    findWithSupplierById: (...args: unknown[]) => mockFindEndpointById(...args),
  },
  aiUpstreamRepo: {
    findById: (...args: unknown[]) => mockFindUpstreamById(...args),
  },
  aiUpstreamAssignmentRepo: {
    findByEndpointAndUpstreamId: (...args: unknown[]) =>
      mockFindEndpointUpstreamAssignment(...args),
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-credentials");

const app = new Hono();
app.route("/", router);

describe("admin ai credential connectivity test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindEndpointCredentialById.mockResolvedValue({
      id: 17,
      endpointId: 7,
      upstreamId: null,
      encryptedKey: "encrypted",
    });
    mockFindEndpointById.mockResolvedValue({
      id: 7,
      endpointId: "deepseek-anthropic",
      name: "DeepSeek Anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      authType: "bearer",
      authConfig: "{}",
      enabled: true,
    });
    mockFindUpstreamById.mockResolvedValue(null);
    mockFindEndpointUpstreamAssignment.mockResolvedValue(null);
    mockFindEnabledModelsByEndpointId.mockResolvedValue([]);
    mockUpdateLastUsed.mockResolvedValue(undefined);
  });

  it("uses the apiFormat-aware models endpoint for Anthropic-compatible endpoints", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await app.request("http://localhost/endpoint-credentials/17/test", {
      method: "POST",
    });
    const json = (await res.json()) as { data: { success: boolean; status: number } };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ success: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/anthropic/models");
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer plain-key",
      "anthropic-version": "2023-06-01",
    });
    expect(mockUpdateLastUsed).toHaveBeenCalledWith(17);
  });

  it("falls back to a minimal Anthropic messages request when models endpoint is unavailable", async () => {
    mockFindEndpointById.mockResolvedValueOnce({
      id: 7,
      endpointId: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiFormat: "anthropic",
      authType: "bearer",
      authConfig: "{}",
      enabled: true,
    });
    mockFetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const res = await app.request("http://localhost/endpoint-credentials/17/test", {
      method: "POST",
    });
    const json = (await res.json()) as { data: { success: boolean; status: number } };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ success: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.anthropic.com/models");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer plain-key",
        "anthropic-version": "2023-06-01",
      }),
    });
    expect(JSON.parse(mockFetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    expect(mockUpdateLastUsed).toHaveBeenCalledWith(17);
  });

  it("uses the configured model for Anthropic-compatible message probes", async () => {
    mockFindEnabledModelsByEndpointId.mockResolvedValueOnce([
      {
        modelId: "deepseek-reasoner",
        clientFormat: "anthropic",
        capabilities: JSON.stringify(["chat"]),
        enabled: true,
      },
    ]);
    mockFetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const res = await app.request("http://localhost/endpoint-credentials/17/test", {
      method: "POST",
    });
    const json = (await res.json()) as { data: { success: boolean; status: number } };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ success: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/anthropic/models");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(JSON.parse(mockFetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: "deepseek-reasoner",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    expect(mockUpdateLastUsed).toHaveBeenCalledWith(17);
  });
});
