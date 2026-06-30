import { beforeEach, describe, expect, it, vi } from "vitest";

import { pingEndpoint } from "@/server/ai/lib/endpoint-health";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

describe("endpoint health ping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the DeepSeek official /models endpoint for OpenAI-compatible discovery", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await pingEndpoint({
      endpoint: {
        endpointId: "deepseek-openai",
        apiFormat: "openai",
        authType: "bearer",
        authConfig: "{}",
      },
      baseUrl: "https://api.deepseek.com",
      plainKey: "test-key",
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
  });

  it("uses /models directly when an OpenAI-compatible base URL already has a version path", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "glm-5.2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await pingEndpoint({
      endpoint: {
        endpointId: "zhipu-glm",
        apiFormat: "openai",
        authType: "bearer",
        authConfig: "{}",
      },
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      plainKey: "test-key",
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://open.bigmodel.cn/api/paas/v4/models");
  });

  it("falls back to a minimal OpenAI chat probe when /models is unavailable", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    const result = await pingEndpoint({
      endpoint: {
        endpointId: "aliyun-bailian-glm",
        apiFormat: "openai",
        authType: "bearer",
        authConfig: "{}",
      },
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      plainKey: "test-key",
      probeModelId: "glm-5.2",
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    );
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer test-key",
      }),
    });
    expect(JSON.parse(mockFetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: "glm-5.2",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
    });
  });

  it("falls back to a DeepSeek Anthropic messages probe when /models is unavailable", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [] }), { status: 200 }));

    const result = await pingEndpoint({
      endpoint: {
        endpointId: "deepseek-anthropic",
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
      endpoint: {
        endpointId: "custom-anthropic-compatible",
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
      endpoint: {
        endpointId: "deepseek-anthropic",
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
