import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindKeyById = vi.fn();
const mockUpdateLastUsed = vi.fn();
const mockFindProviderById = vi.fn();
const mockFindUpstreamById = vi.fn();
const mockFindProviderUpstreamAssignment = vi.fn();
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

vi.mock("@/server/ai/lib/key-balancer", () => ({
  invalidateKeyPool: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiKeyRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: (...args: unknown[]) => mockFindKeyById(...args),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateLastUsed: (...args: unknown[]) => mockUpdateLastUsed(...args),
  },
  aiProviderRepo: {
    findById: (...args: unknown[]) => mockFindProviderById(...args),
  },
  aiUpstreamRepo: {
    findById: (...args: unknown[]) => mockFindUpstreamById(...args),
  },
  aiUpstreamAssignmentRepo: {
    findByProviderAndUpstreamId: (...args: unknown[]) =>
      mockFindProviderUpstreamAssignment(...args),
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-keys");

const app = new Hono();
app.route("/", router);

describe("admin ai key connectivity test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindKeyById.mockResolvedValue({
      id: 17,
      providerId: 7,
      upstreamId: null,
      encryptedKey: "encrypted",
    });
    mockFindProviderById.mockResolvedValue({
      id: 7,
      providerId: "deepseek-anthropic",
      name: "DeepSeek Anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      authType: "bearer",
      authConfig: "{}",
      enabled: true,
    });
    mockFindUpstreamById.mockResolvedValue(null);
    mockFindProviderUpstreamAssignment.mockResolvedValue(null);
    mockUpdateLastUsed.mockResolvedValue(undefined);
  });

  it("uses the apiFormat-aware models endpoint for Anthropic-compatible providers", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await app.request("http://localhost/keys/17/test", { method: "POST" });
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
    mockFindProviderById.mockResolvedValueOnce({
      id: 7,
      providerId: "anthropic",
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

    const res = await app.request("http://localhost/keys/17/test", { method: "POST" });
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

  it("does not use the fixed Anthropic model probe for compatible providers", async () => {
    mockFetch.mockResolvedValue(new Response("not found", { status: 404 }));

    const res = await app.request("http://localhost/keys/17/test", { method: "POST" });
    const json = (await res.json()) as { data: { success: boolean; status: number } };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ success: false, status: 404 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/anthropic/models");
    expect(mockUpdateLastUsed).not.toHaveBeenCalled();
  });
});
