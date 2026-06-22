import { beforeEach, describe, expect, it, vi } from "vitest";

import { pingEndpoint } from "@/server/ai/lib/supplier-health";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

describe("supplier health ping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to a DeepSeek Anthropic messages probe when /models is unavailable", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [] }), { status: 200 }));

    const result = await pingEndpoint({
      provider: {
        providerId: "deepseek-anthropic",
        apiFormat: "anthropic",
        authType: "bearer",
        authConfig: "{}",
      },
      baseUrl: "https://api.deepseek.com/anthropic",
      plainKey: "test-key",
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/anthropic/models");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer test-key",
        "anthropic-version": "2023-06-01",
      }),
    });
    expect(JSON.parse(mockFetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: "deepseek-chat",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("uses an explicit Anthropic probe model when provided", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [] }), { status: 200 }));

    await pingEndpoint({
      provider: {
        providerId: "custom-anthropic-compatible",
        apiFormat: "anthropic",
        authType: "bearer",
        authConfig: "{}",
      },
      baseUrl: "https://anthropic-compatible.example.com",
      plainKey: "test-key",
      anthropicProbeModelId: "custom-chat-model",
    });

    expect(JSON.parse(mockFetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: "custom-chat-model",
    });
  });

  it("does not fall back when a custom models endpoint is configured", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));

    const result = await pingEndpoint({
      provider: {
        providerId: "deepseek-anthropic",
        apiFormat: "anthropic",
        authType: "bearer",
        authConfig: "{}",
      },
      baseUrl: "https://api.deepseek.com/anthropic",
      modelsEndpointOverride: "https://status.example.com/models",
      plainKey: "test-key",
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://status.example.com/models");
  });
});
