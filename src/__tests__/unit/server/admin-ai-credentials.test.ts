import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEndpointCredentialById = vi.fn();
const mockFindEndpointCredentialByScope = vi.fn();
const mockCreateEndpointCredential = vi.fn();
const mockUpdateLastUsed = vi.fn();
const mockFindEndpointById = vi.fn();
const mockFindUpstreamById = vi.fn();
const mockFindEndpointUpstreamAssignment = vi.fn();
const mockFindEnabledModelsByEndpointId = vi.fn();
const mockFindSupplierById = vi.fn();
const mockFindCredentialById = vi.fn();
const mockCreateCredential = vi.fn();
const mockDecrypt = vi.fn();
const mockEncrypt = vi.fn();
const mockHashApiKey = vi.fn();
const mockFetch = vi.fn();
let nextCredentialId = 100;

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/server/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn().mockReturnValue({ adminId: 1 }),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  hashApiKey: (...args: unknown[]) => mockHashApiKey(...args),
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
  aiCredentialRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: (...args: unknown[]) => mockFindCredentialById(...args),
    create: (...args: unknown[]) => mockCreateCredential(...args),
    update: vi.fn(),
    delete: vi.fn(),
  },
  aiEndpointCredentialRepo: {
    findAll: vi.fn().mockResolvedValue([]),
    findById: (...args: unknown[]) => mockFindEndpointCredentialById(...args),
    findByEndpointCredentialAndScope: (...args: unknown[]) =>
      mockFindEndpointCredentialByScope(...args),
    create: (...args: unknown[]) => mockCreateEndpointCredential(...args),
    update: vi.fn(),
    delete: vi.fn(),
    updateLastUsed: (...args: unknown[]) => mockUpdateLastUsed(...args),
  },
  aiModelRepo: {
    findEnabledByEndpointId: (...args: unknown[]) => mockFindEnabledModelsByEndpointId(...args),
  },
  aiEndpointRepo: {
    findById: (...args: unknown[]) => mockFindEndpointById(...args),
    findByIds: vi.fn().mockResolvedValue([{ id: 7, name: "DeepSeek OpenAI" }]),
    findWithSupplierById: (...args: unknown[]) => mockFindEndpointById(...args),
  },
  aiUpstreamRepo: {
    findById: (...args: unknown[]) => mockFindUpstreamById(...args),
    findByIds: vi.fn().mockResolvedValue([]),
  },
  aiUpstreamAssignmentRepo: {
    findByEndpointAndUpstreamId: (...args: unknown[]) =>
      mockFindEndpointUpstreamAssignment(...args),
  },
  aiSupplierRepo: {
    findById: (...args: unknown[]) => mockFindSupplierById(...args),
  },
  keyProviderRepo: {
    findById: vi.fn(),
  },
}));

const { default: router } = await import("@/server/ai/routes/admin-ai-credentials");

const app = new Hono();
app.route("/", router);

describe("admin ai credential connectivity test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextCredentialId = 100;
    mockDecrypt.mockReturnValue("plain-key");
    mockEncrypt.mockReturnValue("encrypted-key");
    mockHashApiKey.mockReturnValue("repeat-key-hash");
    mockFindSupplierById.mockResolvedValue({
      id: 5,
      supplierId: "deepseek",
      name: "DeepSeek",
      enabled: true,
    });
    mockCreateCredential.mockImplementation(async (data) => ({
      id: nextCredentialId++,
      ...data,
      enabled: true,
      lastUsedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }));
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
    mockFindEndpointCredentialByScope.mockResolvedValue(null);
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

describe("admin ai credential creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextCredentialId = 100;
    mockEncrypt.mockReturnValue("encrypted-key");
    mockHashApiKey.mockReturnValue("repeat-key-hash");
    mockFindSupplierById.mockResolvedValue({
      id: 5,
      supplierId: "deepseek",
      name: "DeepSeek",
      enabled: true,
    });
    mockCreateCredential.mockImplementation(async (data) => ({
      id: nextCredentialId++,
      ...data,
      enabled: true,
      lastUsedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }));
    mockFindEndpointCredentialByScope.mockResolvedValue(null);
  });

  it("allows the same API key to be saved as multiple credentials", async () => {
    const body = {
      supplierId: 5,
      name: "Default",
      apiKey: "sk-repeat-key",
      ownerId: null,
    };

    const first = await app.request("http://localhost/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const second = await app.request("http://localhost/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(mockCreateCredential).toHaveBeenCalledTimes(2);
    expect(mockCreateCredential).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        supplierId: 5,
        name: "Default",
        encryptedKey: "encrypted-key",
        keyHash: "repeat-key-hash",
      }),
    );

    const firstJson = (await first.json()) as { data: { id: number } };
    const secondJson = (await second.json()) as { data: { id: number } };
    expect(firstJson.data.id).toBe(100);
    expect(secondJson.data.id).toBe(101);
  });
});

describe("admin ai endpoint credential assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockFindCredentialById.mockResolvedValue({
      id: 100,
      supplierId: 5,
      name: "Default",
      keyPrefix: "sk-repea...",
      enabled: true,
    });
    mockFindEndpointCredentialByScope.mockResolvedValue(null);
    mockCreateEndpointCredential.mockResolvedValue({
      id: 200,
      endpointId: 7,
      credentialId: 100,
      upstreamId: null,
      name: "Default",
      weight: 1,
      enabled: true,
    });
    mockFindEndpointCredentialById.mockResolvedValue({
      id: 200,
      endpointId: 7,
      credentialId: 100,
      upstreamId: null,
      name: "Default",
      weight: 1,
      enabled: true,
      credentialName: "Default",
      keyPrefix: "sk-repea...",
      ownerId: null,
      supplierId: 5,
      credentialEnabled: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("binds an existing credential to an endpoint credential pool", async () => {
    const res = await app.request("http://localhost/endpoint-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpointId: 7,
        credentialId: 100,
        upstreamId: null,
        name: "Default",
        weight: 1,
      }),
    });
    const json = (await res.json()) as { data: { id: number; credentialId: number } };

    expect(res.status).toBe(201);
    expect(json.data).toMatchObject({ id: 200, credentialId: 100 });
    expect(mockCreateEndpointCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 7,
        credentialId: 100,
        upstreamId: null,
        name: "Default",
        weight: 1,
      }),
    );
  });

  it("returns 409 when a credential is already assigned to the same pool", async () => {
    mockFindEndpointCredentialByScope.mockResolvedValueOnce({ id: 200 });

    const res = await app.request("http://localhost/endpoint-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpointId: 7,
        credentialId: 100,
        upstreamId: null,
        name: "Default",
      }),
    });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(json.error).toBe("Credential already assigned to this pool");
    expect(mockCreateEndpointCredential).not.toHaveBeenCalled();
  });
});
