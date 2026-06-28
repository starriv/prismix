/**
 * SSE stream proxy — forwards upstream AI endpoint SSE events to the client.
 *
 * Split into two stages for fallback support:
 * - fetchUpstream(): attempts the HTTP fetch (can be retried with different models)
 * - forwardStream(): pipes a successful upstream Response to the client via Hono streamSSE
 *
 * The combined proxyStream() is kept for non-fallback use.
 *
 * NOTE: Protocol-specific usage extraction (OpenAI / Anthropic / Gemini) is handled inside
 * extractStreamUsageUniversal() as inline branches rather than separate per-protocol adapter
 * files. The stream forwarding is endpoint-agnostic; only the small usage parser has
 * protocol awareness, which doesn't justify the overhead of 3+ files + barrel for ~25 lines each.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { resolveTimeoutConfig, type TimeoutConfig } from "@/server/lib/gateway-config";
import { log } from "@/server/lib/logger";
import {
  aiStreamAbortTotal,
  aiStreamActive,
  aiStreamChunksTotal,
  aiStreamCompletedTotal,
  aiStreamFirstChunkLatency,
  aiStreamStartedTotal,
  gatewayUpstreamDuration,
} from "@/server/lib/metrics";
import { enqueueJob } from "@/server/lib/write-queue";
import { removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import type { ProtocolAdapter, TokenUsage } from "../protocol-adapters/types";
import { markCredentialFailure, markCredentialSuccess } from "./credential-balancer";
import { extractTokenUsageFromUsageObject } from "./token-usage";

/**
 * Idle timeout: abort if no data received from upstream for this long.
 * Anthropic sends `ping` events during extended thinking, so 5 min of true
 * silence means the connection is dead.
 */
export const STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Hard cap: abort unconditionally after this duration regardless of activity.
 * Protects against infinite streams. 30 min covers the longest Claude Code sessions.
 */
export const STREAM_MAX_DURATION_MS = 30 * 60 * 1000;

/**
 * SSE heartbeat interval. Sends a `: heartbeat` comment to keep intermediate
 * proxies (Nginx, Cloudflare, ALB) from closing idle TCP connections.
 */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Maximum SSE buffer size before aborting (1 MB). */
const MAX_BUFFER_SIZE = 1_048_576;

export type StreamAbortReason =
  | "completed"
  | "client_abort"
  | "idle_timeout"
  | "max_duration"
  | "buffer_overflow"
  | "upstream_read_error"
  | "upstream_missing_body";

export interface StreamRuntimeStats {
  started: number;
  completed: number;
  active: number;
  aborts: Record<Exclude<StreamAbortReason, "completed">, number>;
}

const streamRuntimeStats: StreamRuntimeStats = {
  started: 0,
  completed: 0,
  active: 0,
  aborts: {
    client_abort: 0,
    idle_timeout: 0,
    max_duration: 0,
    buffer_overflow: 0,
    upstream_read_error: 0,
    upstream_missing_body: 0,
  },
};

export interface StreamRelayMeta {
  endpointCredentialId: number;
  supplierId?: string | null;
  endpointId: string;
  modelId: string;
  upstreamId?: number | null;
  upstreamName?: string | null;
  upstreamBaseUrl?: string | null;
  requestId: string;
  start: number;
  inputPrice?: string;
  outputPrice?: string;
  /** Serialized request body — passed through for request logging. */
  requestBody?: string;
  routeType?: "chat" | "passthrough";
}

/**
 * Callback invoked after a stream completes with usage data.
 * Used by consumer-relay to debit balance post-stream.
 * rawResponse: accumulated SSE text (only when request logging is enabled).
 */
export type StreamCompleteCallback = (
  usage: TokenUsage | null,
  latencyMs: number,
  rawResponse?: string,
) => Promise<void>;

export interface StreamOutputTransformer {
  transformEvent(openAiEventData: string): Array<{ event?: string; data: string }>;
  transformDone(): Array<{ event?: string; data: string }>;
}

export interface StreamInitialEvent {
  event?: string;
  data: string;
}

export type StreamFinalizeCallback = () => Promise<void> | void;

interface StreamLifecycleState {
  routeType: "chat" | "passthrough";
  chunkCount: number;
  totalBytes: number;
  pingCount: number;
  startedAt: number;
  firstChunkLatencyMs: number | null;
  lastChunkAt: number | null;
  abortReason: StreamAbortReason | null;
}

function createLifecycleState(meta: StreamRelayMeta): StreamLifecycleState {
  return {
    routeType: meta.routeType ?? "chat",
    chunkCount: 0,
    totalBytes: 0,
    pingCount: 0,
    startedAt: Date.now(),
    firstChunkLatencyMs: null,
    lastChunkAt: null,
    abortReason: null,
  };
}

function getRouteType(meta: StreamRelayMeta): "chat" | "passthrough" {
  return meta.routeType ?? "chat";
}

function setAbortReason(state: StreamLifecycleState, reason: StreamAbortReason): void {
  if (state.abortReason === null) {
    state.abortReason = reason;
  }
}

function recordStreamStart(meta: StreamRelayMeta): void {
  const route = getRouteType(meta);
  streamRuntimeStats.started++;
  streamRuntimeStats.active++;
  aiStreamStartedTotal.inc({ endpoint: meta.endpointId, route });
  aiStreamActive.inc({ endpoint: meta.endpointId, route });
}

function recordStreamEnd(meta: StreamRelayMeta, state: StreamLifecycleState): void {
  const route = state.routeType;
  streamRuntimeStats.active = Math.max(0, streamRuntimeStats.active - 1);
  aiStreamActive.dec({ endpoint: meta.endpointId, route });

  const outcome = state.abortReason ?? "completed";
  if (outcome === "completed") {
    streamRuntimeStats.completed++;
  } else {
    streamRuntimeStats.aborts[outcome]++;
    aiStreamAbortTotal.inc({ endpoint: meta.endpointId, route, reason: outcome });
  }
  aiStreamCompletedTotal.inc({ endpoint: meta.endpointId, route, outcome });
}

function observeFirstChunk(meta: StreamRelayMeta, state: StreamLifecycleState): void {
  if (state.firstChunkLatencyMs !== null) return;
  state.firstChunkLatencyMs = Date.now() - meta.start;
  aiStreamFirstChunkLatency.observe(
    { endpoint: meta.endpointId, route: state.routeType },
    state.firstChunkLatencyMs / 1000,
  );
}

function observeChunk(meta: StreamRelayMeta, state: StreamLifecycleState, bytes: number): void {
  state.chunkCount++;
  state.totalBytes += bytes;
  state.lastChunkAt = Date.now();
  observeFirstChunk(meta, state);
  aiStreamChunksTotal.inc({ endpoint: meta.endpointId, route: state.routeType });
}

function tryParseStreamEventType(dataLine: string): string | null {
  try {
    const parsed = JSON.parse(dataLine) as Record<string, unknown>;
    return typeof parsed.type === "string" ? parsed.type : null;
  } catch {
    return null;
  }
}

async function writeStreamError(
  stream: {
    writeSSE: (payload: { event?: string; data: string }) => Promise<void>;
    aborted: boolean;
  },
  reason: Exclude<StreamAbortReason, "completed" | "client_abort">,
  meta: StreamRelayMeta,
): Promise<void> {
  if (stream.aborted) return;
  const messageMap: Record<Exclude<StreamAbortReason, "completed" | "client_abort">, string> = {
    idle_timeout: "Upstream stream was idle for too long",
    max_duration: "Upstream stream exceeded the maximum allowed duration",
    buffer_overflow: "Upstream stream frame exceeded the gateway safety buffer",
    upstream_read_error: "Gateway failed while reading the upstream stream",
    upstream_missing_body: "Upstream response body was missing",
  };
  await stream
    .writeSSE({
      event: "error",
      data: JSON.stringify({
        error: {
          type: reason,
          message: messageMap[reason],
          endpoint: meta.endpointId,
          request_id: meta.requestId,
        },
      }),
    })
    .catch(() => {});
}

export function getStreamRuntimeStats(): StreamRuntimeStats {
  return {
    started: streamRuntimeStats.started,
    completed: streamRuntimeStats.completed,
    active: streamRuntimeStats.active,
    aborts: { ...streamRuntimeStats.aborts },
  };
}

// ── Stage 1: Fetch upstream (retryable) ─────────────────────────────

/**
 * Attempt to fetch the upstream AI endpoint. Returns the Response object.
 * Throws on network error. Does NOT commit SSE headers to the client.
 */
export async function fetchUpstream(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = resolveTimeoutConfig().upstreamFetchMs,
  metricLabels?: { endpoint: string; route: "chat" | "passthrough" },
): Promise<Response> {
  const start = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (metricLabels) {
    gatewayUpstreamDuration.observe(
      { endpoint: metricLabels.endpoint, route: metricLabels.route, phase: "headers" },
      (Date.now() - start) / 1000,
    );
  }
  return response;
}

// ── Stage 2: Forward stream to client (non-retryable) ───────────────

/**
 * Forward a successful upstream SSE Response to the client.
 * Once called, SSE headers are committed — no further retries possible.
 *
 * Connection resilience:
 * - **Idle timeout**: resets on every upstream chunk — detects dead connections.
 * - **Max duration**: hard cap prevents infinite streams.
 * - **Heartbeat**: SSE comments keep intermediate proxies alive.
 * - **Reader cancel**: client disconnect or timeout cancels the upstream reader,
 *   unblocking any pending `reader.read()`.
 */
export function forwardStream(
  c: Context,
  upstreamRes: Response,
  adapter: ProtocolAdapter,
  meta: StreamRelayMeta,
  onComplete?: StreamCompleteCallback,
  timeoutConfig?: Partial<TimeoutConfig>,
  outputTransformer?: StreamOutputTransformer,
  initialEvents?: StreamInitialEvent[],
  onFinalize?: StreamFinalizeCallback,
): Response {
  const timeouts = resolveTimeoutConfig(timeoutConfig);
  const abortController = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const state = createLifecycleState(meta);
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Abort stream + cancel the upstream reader (unblocks pending read). */
  const cancelAll = (reason?: StreamAbortReason) => {
    if (reason) setAbortReason(state, reason);
    abortController.abort();
    activeReader?.cancel().catch(() => {});
  };

  recordStreamStart(meta);

  return streamSSE(c, async (stream) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let errorSent = false;
    const clearTimers = () => {
      if (maxTimer) clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
    };
    const scheduleMaxTimer = () => {
      maxTimer = setTimeout(async () => {
        setAbortReason(state, "max_duration");
        if (!errorSent) {
          await writeStreamError(stream, "max_duration", meta);
          errorSent = true;
        }
        cancelAll("max_duration");
      }, timeouts.streamMaxDurationMs);
    };
    const scheduleIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        setAbortReason(state, "idle_timeout");
        if (!errorSent) {
          await writeStreamError(stream, "idle_timeout", meta);
          errorSent = true;
        }
        cancelAll("idle_timeout");
      }, timeouts.streamIdleMs);
    };

    scheduleMaxTimer();
    scheduleIdleTimer();

    stream.onAbort(() => {
      clearTimers();
      if (heartbeat) clearInterval(heartbeat);
      cancelAll("client_abort");
    });

    if (!upstreamRes.body) {
      clearTimers();
      setAbortReason(state, "upstream_missing_body");
      markCredentialFailure(meta.endpointCredentialId);
      await writeStreamError(stream, "upstream_missing_body", meta);
      errorSent = true;
      recordStreamEnd(meta, state);
      return;
    }

    const reader = upstreamRes.body.getReader();
    activeReader = reader;

    // Start heartbeat — SSE comment keeps proxies (Nginx/Cloudflare/ALB) from closing idle TCP
    heartbeat = setInterval(async () => {
      if (!stream.aborted) {
        await stream.write(": heartbeat\n\n").catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);

    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage | null = null;
    let sentDone = false;
    const captureResponse = !!meta.requestBody;
    const responseChunks: string[] = [];

    try {
      for (const initialEvent of initialEvents ?? []) {
        const events = outputTransformer?.transformEvent(initialEvent.data) ?? [initialEvent];
        for (const event of events) {
          await stream.writeSSE(event);
        }
      }

      while (!stream.aborted && !abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        // Reset idle timer — upstream is still sending data
        scheduleIdleTimer();
        observeChunk(meta, state, value.byteLength);

        buffer += decoder.decode(value, { stream: true });

        // M3: Guard against unbounded buffer growth
        if (buffer.length > MAX_BUFFER_SIZE) {
          setAbortReason(state, "buffer_overflow");
          log.gateway.error(
            { endpoint: meta.endpointId, model: meta.modelId, requestId: meta.requestId },
            "AI relay SSE buffer overflow",
          );
          cancelAll("buffer_overflow");
          await writeStreamError(stream, "buffer_overflow", meta);
          errorSent = true;
          break;
        }

        const frames = splitSSEFrames(buffer);
        buffer = frames.remainder;

        for (const frame of frames.complete) {
          if (captureResponse) responseChunks.push(frame);

          const dataLine = extractDataLine(frame);
          if (dataLine === null) continue;

          if (tryParseStreamEventType(dataLine) === "ping") {
            state.pingCount++;
          }

          if (adapter.isStreamDone(dataLine)) {
            state.abortReason = "completed";
            const doneEvents = outputTransformer?.transformDone() ?? [{ data: "[DONE]" }];
            for (const event of doneEvents) {
              await stream.writeSSE(event);
            }
            sentDone = true;
            break;
          }

          // M1: Accumulate usage — adapter first, universal fallback second
          const frameUsage =
            adapter.extractStreamUsage(dataLine) ?? extractStreamUsageUniversal(dataLine);
          if (frameUsage) {
            usage = usage ? mergeUsage(usage, frameUsage) : frameUsage;
          }

          const transformed = adapter.transformStreamEvent(dataLine);
          if (transformed !== null) {
            const events = outputTransformer?.transformEvent(transformed) ?? [
              { data: transformed },
            ];
            for (const event of events) {
              await stream.writeSSE(event);
            }
          }
        }
      }

      // M6: Send synthetic [DONE] if the adapter never triggered it (e.g., Gemini)
      if (
        !sentDone &&
        !stream.aborted &&
        (state.abortReason === null || state.abortReason === "completed")
      ) {
        state.abortReason = "completed";
        const doneEvents = outputTransformer?.transformDone() ?? [{ data: "[DONE]" }];
        for (const event of doneEvents) {
          await stream.writeSSE(event);
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.name === "AbortError" &&
        state.abortReason &&
        state.abortReason !== "completed" &&
        state.abortReason !== "client_abort" &&
        !errorSent
      ) {
        await writeStreamError(stream, state.abortReason, meta);
        errorSent = true;
      }
      if (err instanceof Error && err.name !== "AbortError") {
        setAbortReason(state, "upstream_read_error");
        log.gateway.error(
          { err, endpoint: meta.endpointId, model: meta.modelId },
          "AI relay stream read error",
        );
        await writeStreamError(stream, "upstream_read_error", meta);
        errorSent = true;
      }
    } finally {
      clearTimers();
      if (heartbeat) clearInterval(heartbeat);
      reader.releaseLock();
      recordStreamEnd(meta, state);

      const latencyMs = Date.now() - meta.start;
      const rawResponse = captureResponse ? responseChunks.join("\n\n") : undefined;

      if (onFinalize) {
        try {
          await onFinalize();
        } catch (err) {
          log.gateway.error({ err, requestId: meta.requestId }, "Stream finalize callback failed");
        }
      }

      if (onComplete) {
        // Consumer relay handles its own usage logging (with consumerKeyId + markup cost)
      } else {
        // Admin relay — log usage here
        const cost = calculateCost(usage, meta);
        enqueueUsageLog(meta, upstreamRes.status, latencyMs, usage, undefined, cost);
        enqueueJob("ai-endpoint-credential-touch", {
          endpointCredentialId: meta.endpointCredentialId,
        });
      }

      // Consumer billing callback — debit balance after usage is known
      if (onComplete) {
        onComplete(usage, latencyMs, rawResponse).catch((err) => {
          log.gateway.error(
            { err, requestId: meta.requestId },
            "Stream onComplete callback failed",
          );
        });
      }

      if (state.abortReason === "completed" || state.abortReason === null) {
        markCredentialSuccess(meta.endpointCredentialId);
      } else if (state.abortReason !== "client_abort") {
        markCredentialFailure(meta.endpointCredentialId);
      }

      log.gateway.info(
        {
          endpoint: meta.endpointId,
          model: meta.modelId,
          requestId: meta.requestId,
          routeType: state.routeType,
          abortReason: state.abortReason ?? "completed",
          chunksSeen: state.chunkCount,
          bytesSeen: state.totalBytes,
          pingCount: state.pingCount,
          firstChunkLatencyMs: state.firstChunkLatencyMs,
          lastChunkAt: state.lastChunkAt,
          latencyMs,
        },
        "AI relay stream finished",
      );
    }
  });
}

// ── SSE Frame Parsing ───────────────────────────────────────────────

interface SSEParseResult {
  complete: string[];
  remainder: string;
}

/** Split a buffer into complete SSE frames (delimited by \n\n) and a remainder. */
export function splitSSEFrames(buffer: string): SSEParseResult {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { complete: parts.filter((p) => p.length > 0), remainder };
}

/** Extract the `data:` field value from an SSE frame. Returns null if no data line. */
export function extractDataLine(frame: string): string | null {
  const lines = frame.split("\n");
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5));
    }
  }

  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

// ── Stage 3: Passthrough stream (adapter-free) ────────────────────────

/**
 * Forward an upstream SSE stream to the client without any adapter transformation.
 * Parses each SSE frame to extract usage via universal pattern matching
 * (OpenAI / Anthropic / Gemini), then forwards the raw frame as-is.
 *
 * Used by generic `/v1/*` passthrough routes that don't know the upstream protocol format.
 * Same resilience features as forwardStream: idle timeout, heartbeat, reader cancel.
 */
export function forwardPassthroughStream(
  c: Context,
  upstreamRes: Response,
  meta: StreamRelayMeta,
  onComplete?: StreamCompleteCallback,
  timeoutConfig?: Partial<TimeoutConfig>,
  initialEvents?: StreamInitialEvent[],
  onFinalize?: StreamFinalizeCallback,
): Response {
  const timeouts = resolveTimeoutConfig(timeoutConfig);
  const abortController = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const state = createLifecycleState({ ...meta, routeType: "passthrough" });
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelAll = (reason?: StreamAbortReason) => {
    if (reason) setAbortReason(state, reason);
    abortController.abort();
    activeReader?.cancel().catch(() => {});
  };

  recordStreamStart({ ...meta, routeType: "passthrough" });

  return streamSSE(c, async (stream) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let errorSent = false;
    const clearTimers = () => {
      if (maxTimer) clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
    };
    const scheduleMaxTimer = () => {
      maxTimer = setTimeout(async () => {
        setAbortReason(state, "max_duration");
        if (!errorSent) {
          await writeStreamError(stream, "max_duration", meta);
          errorSent = true;
        }
        cancelAll("max_duration");
      }, timeouts.streamMaxDurationMs);
    };
    const scheduleIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        setAbortReason(state, "idle_timeout");
        if (!errorSent) {
          await writeStreamError(stream, "idle_timeout", meta);
          errorSent = true;
        }
        cancelAll("idle_timeout");
      }, timeouts.streamIdleMs);
    };

    scheduleMaxTimer();
    scheduleIdleTimer();

    stream.onAbort(() => {
      clearTimers();
      if (heartbeat) clearInterval(heartbeat);
      cancelAll("client_abort");
    });

    if (!upstreamRes.body) {
      clearTimers();
      setAbortReason(state, "upstream_missing_body");
      markCredentialFailure(meta.endpointCredentialId);
      await writeStreamError(stream, "upstream_missing_body", meta);
      errorSent = true;
      recordStreamEnd({ ...meta, routeType: "passthrough" }, state);
      return;
    }

    const reader = upstreamRes.body.getReader();
    activeReader = reader;

    heartbeat = setInterval(async () => {
      if (!stream.aborted) {
        await stream.write(": heartbeat\n\n").catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);

    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage | null = null;
    const captureResponse = !!meta.requestBody;
    const responseChunks: string[] = [];

    try {
      for (const initialEvent of initialEvents ?? []) {
        await stream.writeSSE(initialEvent);
      }

      while (!stream.aborted && !abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        // Reset idle timer — upstream is still sending data
        scheduleIdleTimer();
        observeChunk(meta, state, value.byteLength);

        buffer += decoder.decode(value, { stream: true });

        if (buffer.length > MAX_BUFFER_SIZE) {
          setAbortReason(state, "buffer_overflow");
          log.gateway.error({ endpoint: meta.endpointId }, "AI passthrough SSE buffer overflow");
          cancelAll("buffer_overflow");
          await writeStreamError(stream, "buffer_overflow", meta);
          errorSent = true;
          break;
        }

        const frames = splitSSEFrames(buffer);
        buffer = frames.remainder;

        for (const frame of frames.complete) {
          if (captureResponse) responseChunks.push(frame);

          // Extract usage from data lines (universal: OpenAI/Anthropic/Gemini)
          const dataLine = extractDataLine(frame);
          if (dataLine !== null) {
            if (tryParseStreamEventType(dataLine) === "ping") {
              state.pingCount++;
            }
            const frameUsage = extractStreamUsageUniversal(dataLine);
            if (frameUsage) {
              usage = usage ? mergeUsage(usage, frameUsage) : frameUsage;
            }
          }

          // Forward the entire raw frame (preserving event:, data:, etc.)
          await stream.write(`${frame}\n\n`);
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.name === "AbortError" &&
        state.abortReason &&
        state.abortReason !== "completed" &&
        state.abortReason !== "client_abort" &&
        !errorSent
      ) {
        await writeStreamError(stream, state.abortReason, meta);
        errorSent = true;
      }
      if (err instanceof Error && err.name !== "AbortError") {
        setAbortReason(state, "upstream_read_error");
        log.gateway.error(
          { err, endpoint: meta.endpointId, model: meta.modelId },
          "AI passthrough stream read error",
        );
        await writeStreamError(stream, "upstream_read_error", meta);
        errorSent = true;
      }
    } finally {
      clearTimers();
      if (heartbeat) clearInterval(heartbeat);
      reader.releaseLock();
      recordStreamEnd({ ...meta, routeType: "passthrough" }, state);

      const latencyMs = Date.now() - meta.start;
      const rawResponse = captureResponse ? responseChunks.join("\n\n") : undefined;

      if (onFinalize) {
        try {
          await onFinalize();
        } catch (err) {
          log.gateway.error({ err, requestId: meta.requestId }, "Stream finalize callback failed");
        }
      }

      if (onComplete) {
        onComplete(usage, latencyMs, rawResponse).catch((err) => {
          log.gateway.error(
            { err, requestId: meta.requestId },
            "Passthrough stream onComplete callback failed",
          );
        });
      } else {
        const cost = calculateCost(usage, meta);
        enqueueUsageLog(meta, upstreamRes.status, latencyMs, usage, undefined, cost);
        enqueueJob("ai-endpoint-credential-touch", {
          endpointCredentialId: meta.endpointCredentialId,
        });
      }

      if (state.abortReason === "completed" || state.abortReason === null) {
        markCredentialSuccess(meta.endpointCredentialId);
      } else if (state.abortReason !== "client_abort") {
        markCredentialFailure(meta.endpointCredentialId);
      }

      log.gateway.info(
        {
          endpoint: meta.endpointId,
          model: meta.modelId,
          requestId: meta.requestId,
          routeType: state.routeType,
          abortReason: state.abortReason ?? "completed",
          chunksSeen: state.chunkCount,
          bytesSeen: state.totalBytes,
          pingCount: state.pingCount,
          firstChunkLatencyMs: state.firstChunkLatencyMs,
          lastChunkAt: state.lastChunkAt,
          latencyMs,
        },
        "AI passthrough stream finished",
      );
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Merge two TokenUsage objects, summing all fields including optional cache tokens. */
function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cacheCreationInputTokens:
      (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0) || undefined,
    cacheReadInputTokens:
      (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0) || undefined,
  };
}

/** Retryable upstream status codes for fallback. */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Extract token usage from a raw JSON response string.
 * Supports both OpenAI (`usage.prompt_tokens`) and Anthropic (`usage.input_tokens`) shapes.
 * Used by generic passthrough routes that don't have a ProtocolAdapter.
 */
export function extractPassthroughUsage(text: string): TokenUsage | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;

    // Try top-level usage first (Chat Completions, Anthropic Messages)
    let usage = obj?.usage as Record<string, unknown> | undefined;

    // OpenAI Responses API: usage nested inside response object
    if (!usage) {
      const response = obj?.response as Record<string, unknown> | undefined;
      usage = response?.usage as Record<string, unknown> | undefined;
    }

    if (!usage) return null;

    return extractTokenUsageFromUsageObject(usage);
  } catch {
    return null;
  }
}

/**
 * Extract token usage from a single SSE data line without knowing the upstream protocol format.
 * Covers OpenAI, Anthropic, and Gemini streaming usage shapes.
 *
 * Returns partial counts per frame — caller must accumulate across frames.
 */
export function extractStreamUsageUniversal(dataLine: string): TokenUsage | null {
  try {
    const obj = JSON.parse(dataLine) as Record<string, unknown>;
    const eventType = obj.type as string | undefined;

    // ── Anthropic: type-discriminated events ──
    // message_start → only input_tokens (in message.usage)
    // message_delta → only output_tokens (in top-level usage)
    // Other Anthropic events (content_block_delta, ping, etc.) have no usage.
    // IMPORTANT: message_delta.usage.input_tokens is a cumulative repeat of
    // message_start — must be ignored to avoid double-counting.
    if (eventType === "message_start") {
      const message = obj.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, unknown> | undefined;
      if (!usage) return null;
      const baseInput = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const cacheCreation =
        typeof usage.cache_creation_input_tokens === "number"
          ? usage.cache_creation_input_tokens
          : 0;
      const cacheRead =
        typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
      const inputTokens = baseInput + cacheCreation + cacheRead;
      return inputTokens > 0
        ? {
            inputTokens,
            outputTokens: 0,
            totalTokens: inputTokens,
            cacheCreationInputTokens: cacheCreation || undefined,
            cacheReadInputTokens: cacheRead || undefined,
          }
        : null;
    }
    if (eventType === "message_delta") {
      const usage = obj.usage as Record<string, unknown> | undefined;
      if (!usage) return null;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      return outputTokens > 0 ? { inputTokens: 0, outputTokens, totalTokens: outputTokens } : null;
    }
    // Skip all other known Anthropic event types (no usage data)
    if (
      eventType === "content_block_start" ||
      eventType === "content_block_delta" ||
      eventType === "content_block_stop" ||
      eventType === "message_stop" ||
      eventType === "ping" ||
      eventType === "error"
    ) {
      return null;
    }

    // ── OpenAI Responses API: response.completed → response.usage ──
    // {"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":5}}}
    if (eventType === "response.completed") {
      const response = obj.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;
      return extractTokenUsageFromUsageObject(usage);
    }
    // Skip other OpenAI Responses API events without usage
    if (eventType?.startsWith("response.")) return null;

    // ── OpenAI Chat Completions: usage at top level (final chunk) ──
    // {"usage":{"prompt_tokens":9,"completion_tokens":5,"total_tokens":14}}
    const topUsage = obj.usage as Record<string, unknown> | undefined;
    if (topUsage) {
      return extractTokenUsageFromUsageObject(topUsage);
    }

    // ── Gemini: usageMetadata ──
    // {"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":5}}
    const geminiMeta = obj.usageMetadata as Record<string, unknown> | undefined;
    if (geminiMeta) {
      const input =
        typeof geminiMeta.promptTokenCount === "number" ? geminiMeta.promptTokenCount : 0;
      const output =
        typeof geminiMeta.candidatesTokenCount === "number" ? geminiMeta.candidatesTokenCount : 0;
      if (input > 0 || output > 0) {
        return { inputTokens: input, outputTokens: output, totalTokens: input + output };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function calculateCost(
  usage: TokenUsage | null | undefined,
  meta: StreamRelayMeta,
): string | undefined {
  if (!usage || !meta.inputPrice || !meta.outputPrice) return undefined;
  const inputCost = safeDividedBy(safeMultipliedBy(usage.inputTokens, meta.inputPrice), 1_000_000);
  const outputCost = safeDividedBy(
    safeMultipliedBy(usage.outputTokens, meta.outputPrice),
    1_000_000,
  );
  return removeTailingZero(safePlus(inputCost, outputCost), 6);
}

function enqueueUsageLog(
  meta: StreamRelayMeta,
  statusCode: number,
  latencyMs: number,
  usage?: TokenUsage | null,
  error?: string,
  estimatedCost?: string,
): void {
  enqueueJob("ai-usage-log", {
    endpointCredentialId: meta.endpointCredentialId,
    supplierId: meta.supplierId ?? null,
    endpointId: meta.endpointId,
    modelId: meta.modelId,
    upstreamId: meta.upstreamId ?? null,
    upstreamName: meta.upstreamName ?? null,
    upstreamBaseUrl: meta.upstreamBaseUrl ?? null,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
    estimatedCost: estimatedCost ?? null,
    latencyMs,
    statusCode,
    requestId: meta.requestId,
    error: error ?? null,
  } as Record<string, unknown>);
}
