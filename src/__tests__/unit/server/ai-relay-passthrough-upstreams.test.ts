import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEnabledByModelId = vi.fn();
const mockResolveUpstreamCandidates = vi.fn();
const mockPickKey = vi.fn();
const mockDecrypt = vi.fn();
const mockFetch = vi.fn();
const mockEnqueueJob = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn().mockReturnValue({ adminId: 1 }),
}));

vi.mock("@/server/middleware/request-id", () => ({
  getRequestId: vi.fn().mockReturnValue("req-test"),
}));

vi.mock("@/server/repos", () => ({
  aiGuardrailConfigRepo: { findAllEnabled: vi.fn().mockResolvedValue([]) },
  aiModelRepo: {
    findEnabledByModelId: (...args: unknown[]) => mockFindEnabledByModelId(...args),
  },
  settingsRepo: {
    getGlobal: vi.fn().mockResolvedValue("false"),
  },
}));

vi.mock("@/server/ai/lib/upstream-routing", () => ({
  MAX_UPSTREAM_ATTEMPTS: 5,
  resolveUpstreamCandidates: (...args: unknown[]) => mockResolveUpstreamCandidates(...args),
}));

vi.mock("@/server/ai/lib/key-balancer", () => ({
  pickKey: (...args: unknown[]) => mockPickKey(...args),
  markKeyFailure: vi.fn(),
  markKeySuccess: vi.fn(),
}));

vi.mock("@/server/lib/crypto", () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    pricing: { debug: vi.fn() },
  },
}));

const { default: relay } = await import("@/server/ai/routes/relay");

const app = new Hono();
app.route("/", relay);

describe("admin relay passthrough upstream routing", () => {
  beforeEach(() => {
    mockFindEnabledByModelId.mockReset();
    mockResolveUpstreamCandidates.mockReset();
    mockPickKey.mockReset();
    mockDecrypt.mockReset();
    mockFetch.mockReset();
    mockEnqueueJob.mockReset();

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
    mockDecrypt.mockReturnValue("plain-key");
  });

  it("routes passthrough requests through configured upstream candidates", async () => {
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
    expect(mockPickKey).toHaveBeenCalledWith(7, 11);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/v1/messages");
  });

  it("falls back to the next upstream after a retryable failure", async () => {
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
    mockPickKey
      .mockResolvedValueOnce({
        id: 123,
        providerId: 7,
        upstreamId: 11,
        encryptedKey: "encrypted-1",
        name: "friend-key",
      })
      .mockResolvedValueOnce({
        id: 456,
        providerId: 7,
        upstreamId: null,
        encryptedKey: "encrypted-2",
        name: "official-key",
      });
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
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
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://friend-a.example.com/v1/messages");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.anthropic.com/v1/messages");
  });
});
