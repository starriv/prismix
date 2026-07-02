/**
 * Stream proxy resilience tests — idle timeout, heartbeat, reader cancel, body limit.
 *
 * Tests the connection-stability improvements for long-running AI streams
 * (e.g. Claude Code with extended thinking).
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markCredentialFailure } from "@/server/ai/lib/credential-balancer";
import {
  forwardPassthroughStream,
  forwardStream,
  HEARTBEAT_INTERVAL_MS,
  STREAM_IDLE_TIMEOUT_MS,
  STREAM_MAX_DURATION_MS,
  type StreamRelayMeta,
} from "@/server/ai/lib/stream-proxy";

// Mock write-queue to avoid transitive DB/Redis initialization
vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: vi.fn(),
  registerWriteHandler: vi.fn(),
}));

// Mock logger to avoid side effects
vi.mock("@/server/lib/logger", () => ({
  log: { gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

vi.mock("@/server/ai/lib/credential-balancer", () => ({
  markCredentialFailure: vi.fn(),
  markCredentialSuccess: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal StreamRelayMeta for testing. */
function makeMeta(overrides?: Partial<StreamRelayMeta>): StreamRelayMeta {
  return {
    endpointCredentialId: 1,
    endpointId: "test-provider",
    modelId: "test-model",
    requestId: "req-test",
    start: Date.now(),
    ...overrides,
  };
}

/** Create a ReadableStream from an array of SSE frame strings with configurable delay. */
function makeSSEStream(frames: string[], delayMs = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= frames.length) {
        controller.close();
        return;
      }
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      controller.enqueue(encoder.encode(frames[index]!));
      index++;
    },
  });
}

/** Minimal passthrough adapter for testing forwardStream. */
const passthroughAdapter = {
  format: "openai" as const,
  buildUrl: (base: string) => base,
  transformRequest: (b: unknown) => b,
  transformResponse: (b: unknown) => b as never,
  extractUsage: () => null,
  transformStreamEvent: (data: string) => data,
  extractStreamUsage: () => null,
  isStreamDone: (data: string) => data === "[DONE]",
};

/** Simulate a Hono request/response cycle for stream functions. */
async function captureStreamOutput(
  streamFn: (c: import("hono").Context) => Response,
): Promise<{ text: string; status: number }> {
  const app = new Hono();
  app.get("/test", (c) => streamFn(c));

  const res = await app.request("/test");
  const text = await res.text();
  return { text, status: res.status };
}

// ── Exported constants ──────────────────────────────────────────────

describe("stream-proxy exported constants", () => {
  it("STREAM_IDLE_TIMEOUT_MS is 5 minutes", () => {
    expect(STREAM_IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it("STREAM_MAX_DURATION_MS is 30 minutes", () => {
    expect(STREAM_MAX_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("HEARTBEAT_INTERVAL_MS is 15 seconds", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });
});

// ── forwardStream — basic streaming ─────────────────────────────────

describe("forwardStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards SSE frames and sends [DONE]", async () => {
    const frames = ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', "data: [DONE]\n\n"];
    const body = makeSSEStream(frames);
    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const { text } = await captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta()),
    );

    expect(text).toContain('data: {"choices":[{"delta":{"content":"Hi"}}]}');
    expect(text).toContain("data: [DONE]");
  });

  it("sends synthetic [DONE] when adapter never triggers it", async () => {
    // Adapter that never returns isStreamDone=true
    const noDoneAdapter = { ...passthroughAdapter, isStreamDone: () => false };
    const frames = ['data: {"text":"hi"}\n\n'];
    const body = makeSSEStream(frames);
    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const { text } = await captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, noDoneAdapter, makeMeta()),
    );

    expect(text).toContain("data: [DONE]");
  });

  it("handles upstream with no body", async () => {
    const upstreamRes = new Response(null, { status: 200 });

    const { text } = await captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta()),
    );

    expect(text).toContain("event: error");
    expect(text).toContain('"type":"upstream_missing_body"');
    expect(markCredentialFailure).toHaveBeenCalledWith(1);
  });

  it("calls onComplete callback after stream finishes", async () => {
    const frames = ["data: [DONE]\n\n"];
    const body = makeSSEStream(frames);
    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);

    await captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta(), onComplete),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    const [usage, latencyMs, rawResponse, performanceMetrics] = onComplete.mock.calls[0]!;
    expect(usage).toBeNull();
    expect(typeof latencyMs).toBe("number");
    expect(rawResponse).toBeUndefined();
    expect(performanceMetrics).toMatchObject({
      routeType: "chat",
      isStream: true,
      streamAbortReason: "completed",
      streamChunks: 1,
      streamBytes: expect.any(Number),
      responseBytes: expect.any(Number),
      streamPingCount: 0,
      firstChunkMs: expect.any(Number),
    });
    expect(performanceMetrics).not.toHaveProperty("firstTokenMs");
  });

  it("sets firstTokenMs on first content-bearing OpenAI delta", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const body = makeSSEStream(frames);
    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);

    await captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta(), onComplete),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    const [, , , performanceMetrics] = onComplete.mock.calls[0]!;
    expect(performanceMetrics).toMatchObject({
      firstChunkMs: expect.any(Number),
      firstTokenMs: expect.any(Number),
    });
    expect(performanceMetrics.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("sends heartbeat comments to keep connection alive", async () => {
    // Create a stream that takes > 1 heartbeat interval to complete
    let resolve: () => void;
    const waitPromise = new Promise<void>((r) => {
      resolve = r;
    });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        // Send initial frame
        controller.enqueue(encoder.encode('data: {"text":"start"}\n\n'));
        // Wait for test to advance timers, then close
        await waitPromise;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const resultPromise = captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta()),
    );

    // Advance past 1 heartbeat interval
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 100);

    // Release the stream
    resolve!();
    await vi.advanceTimersByTimeAsync(100);

    const { text } = await resultPromise;
    expect(text).toContain(": heartbeat");
  });
});

// ── forwardPassthroughStream — basic streaming ──────────────────────

describe("forwardPassthroughStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards raw SSE frames without transformation", async () => {
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const body = makeSSEStream(frames);
    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const { text } = await captureStreamOutput((c) =>
      forwardPassthroughStream(c, upstreamRes, makeMeta()),
    );

    // Raw frames should be preserved
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");
  });

  it("extracts usage from Anthropic passthrough frames", async () => {
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const body = makeSSEStream(frames);
    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);

    await captureStreamOutput((c) =>
      forwardPassthroughStream(c, upstreamRes, makeMeta(), onComplete),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    const [usage] = onComplete.mock.calls[0]!;
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    const [, , , performanceMetrics] = onComplete.mock.calls[0]!;
    expect(performanceMetrics).toMatchObject({
      routeType: "passthrough",
      isStream: true,
      streamAbortReason: "completed",
      streamChunks: expect.any(Number),
      streamBytes: expect.any(Number),
      responseBytes: expect.any(Number),
      streamPingCount: 0,
      firstChunkMs: expect.any(Number),
    });
    expect(performanceMetrics).not.toHaveProperty("firstTokenMs");
  });

  it("handles upstream with no body", async () => {
    const upstreamRes = new Response(null, { status: 200 });

    const { text } = await captureStreamOutput((c) =>
      forwardPassthroughStream(c, upstreamRes, makeMeta()),
    );

    expect(text).toContain("event: error");
    expect(text).toContain('"type":"upstream_missing_body"');
    expect(markCredentialFailure).toHaveBeenCalledWith(1);
  });

  it("sends heartbeat comments", async () => {
    let resolve: () => void;
    const waitPromise = new Promise<void>((r) => {
      resolve = r;
    });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"text":"start"}\n\n'));
        await waitPromise;
        controller.enqueue(encoder.encode('data: {"text":"end"}\n\n'));
        controller.close();
      },
    });

    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const resultPromise = captureStreamOutput((c) =>
      forwardPassthroughStream(c, upstreamRes, makeMeta()),
    );

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 100);

    resolve!();
    await vi.advanceTimersByTimeAsync(100);

    const { text } = await resultPromise;
    expect(text).toContain(": heartbeat");
  });
});

// ── Idle timeout ────────────────────────────────────────────────────

describe("idle timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("idle timer resets on each chunk (stream survives past idle timeout if data keeps flowing)", async () => {
    // Send chunks at intervals shorter than idle timeout — stream should complete normally
    const encoder = new TextEncoder();
    let chunkIndex = 0;
    const totalChunks = 3;

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunkIndex >= totalChunks) {
          controller.close();
          return;
        }
        // Each chunk arrives well within idle timeout
        await new Promise((r) => setTimeout(r, 1000));
        const data =
          chunkIndex === totalChunks - 1 ? "data: [DONE]\n\n" : `data: {"chunk":${chunkIndex}}\n\n`;
        controller.enqueue(encoder.encode(data));
        chunkIndex++;
      },
    });

    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);

    const resultPromise = captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta(), onComplete),
    );

    // Advance time for all chunks (3 * 1s + margin)
    await vi.advanceTimersByTimeAsync(5_000);

    const { text } = await resultPromise;
    expect(text).toContain("data: [DONE]");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("emits a structured error event on idle timeout instead of [DONE]", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"chunk":0}\n\n'));
      },
      cancel() {
        return Promise.resolve();
      },
    });

    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const resultPromise = captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta()),
    );

    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS + 100);

    const { text } = await resultPromise;
    expect(text).toContain("event: error");
    expect(text).toContain('"type":"idle_timeout"');
    expect(text).not.toContain("data: [DONE]");
  });
});

// ── Body limit routing ──────────────────────────────────────────────

describe("body limit routing", () => {
  it("allows 20MB body for /api/gateway/ai/ routes", async () => {
    const app = new Hono();

    // Replicate the production middleware pattern
    app.use("/api/*", async (c, next) => {
      const maxSize = c.req.path.startsWith("/api/gateway/ai/")
        ? 20 * 1024 * 1024
        : 1 * 1024 * 1024;
      return bodyLimit({ maxSize })(c, next);
    });

    app.post("/api/gateway/ai/anthropic/v1/messages", (c) => c.json({ ok: true }));
    app.post("/api/other", (c) => c.json({ ok: true }));

    // 2 MB body — should pass gateway, fail other
    // bodyLimit checks Content-Length header for fast-path rejection
    const bodySize = 2 * 1024 * 1024;
    const largeBody = "x".repeat(bodySize);

    const gatewayRes = await app.request("/api/gateway/ai/anthropic/v1/messages", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bodySize),
      },
    });
    expect(gatewayRes.status).toBe(200);

    const otherRes = await app.request("/api/other", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bodySize),
      },
    });
    expect(otherRes.status).toBe(413);
  });

  it("still enforces 1MB for non-gateway API routes", async () => {
    const app = new Hono();
    app.use("/api/*", async (c, next) => {
      const maxSize = c.req.path.startsWith("/api/gateway/ai/")
        ? 20 * 1024 * 1024
        : 1 * 1024 * 1024;
      return bodyLimit({ maxSize })(c, next);
    });
    app.post("/api/admin/settings", (c) => c.json({ ok: true }));

    const bodySize = 512 * 1024; // 512 KB — should pass
    const smallBody = "x".repeat(bodySize);
    const res = await app.request("/api/admin/settings", {
      method: "POST",
      body: smallBody,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bodySize),
      },
    });
    expect(res.status).toBe(200);
  });

  it("allows up to 20MB for gateway", async () => {
    const app = new Hono();
    app.use("/api/*", async (c, next) => {
      const maxSize = c.req.path.startsWith("/api/gateway/ai/")
        ? 20 * 1024 * 1024
        : 1 * 1024 * 1024;
      return bodyLimit({ maxSize })(c, next);
    });
    app.post("/api/gateway/ai/openai/v1/chat/completions", (c) => c.json({ ok: true }));

    // 15 MB body — under 20 MB limit
    const bodySize = 15 * 1024 * 1024;
    const body15MB = "x".repeat(bodySize);
    const res = await app.request("/api/gateway/ai/openai/v1/chat/completions", {
      method: "POST",
      body: body15MB,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bodySize),
      },
    });
    expect(res.status).toBe(200);
  });

  it("rejects body exceeding 20MB for gateway", async () => {
    const app = new Hono();
    app.use("/api/*", async (c, next) => {
      const maxSize = c.req.path.startsWith("/api/gateway/ai/")
        ? 20 * 1024 * 1024
        : 1 * 1024 * 1024;
      return bodyLimit({ maxSize })(c, next);
    });
    app.post("/api/gateway/ai/openai/v1/chat/completions", (c) => c.json({ ok: true }));

    // 21 MB body — over limit
    const bodySize = 21 * 1024 * 1024;
    const body21MB = "x".repeat(bodySize);
    const res = await app.request("/api/gateway/ai/openai/v1/chat/completions", {
      method: "POST",
      body: body21MB,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bodySize),
      },
    });
    expect(res.status).toBe(413);
  });
});

// ── Heartbeat format ────────────────────────────────────────────────

describe("heartbeat format", () => {
  it("heartbeat is a valid SSE comment (starts with colon)", () => {
    const heartbeat = ": heartbeat\n\n";
    // SSE spec: lines starting with ":" are comments, ignored by EventSource
    expect(heartbeat.startsWith(":")).toBe(true);
    // Must end with double newline (SSE frame delimiter)
    expect(heartbeat.endsWith("\n\n")).toBe(true);
  });

  it("heartbeat is not treated as a data line by extractDataLine", async () => {
    const { extractDataLine } = await import("@/server/ai/lib/stream-proxy");
    // If a heartbeat comment somehow ends up in the SSE buffer parsing,
    // it should NOT be extracted as a data line
    expect(extractDataLine(": heartbeat")).toBeNull();
  });
});

// ── Buffer overflow ─────────────────────────────────────────────────

describe("buffer overflow protection", () => {
  it("forwardStream breaks on buffer overflow (1 MB)", async () => {
    // Create a stream that sends a single huge chunk > 1 MB
    const encoder = new TextEncoder();
    const hugeData = "x".repeat(2 * 1024 * 1024); // 2 MB of data in one chunk, no \n\n
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(hugeData));
        controller.close();
      },
    });

    const upstreamRes = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);
    const { text } = await captureStreamOutput((c) =>
      forwardStream(c, upstreamRes, passthroughAdapter, makeMeta(), onComplete),
    );

    // Should still call onComplete (billing must happen even on overflow)
    expect(onComplete).toHaveBeenCalledTimes(1);
    // The huge data should NOT be forwarded (loop breaks before processing)
    expect(text).not.toContain(hugeData);
    expect(text).toContain("event: error");
    expect(text).toContain('"type":"buffer_overflow"');
    expect(text).not.toContain("data: [DONE]");
  });
});
