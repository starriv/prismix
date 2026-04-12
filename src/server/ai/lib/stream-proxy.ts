/**
 * SSE stream proxy — forwards upstream AI provider SSE events to the client.
 *
 * Split into two stages for fallback support:
 * - fetchUpstream(): attempts the HTTP fetch (can be retried with different models)
 * - forwardStream(): pipes a successful upstream Response to the client via Hono streamSSE
 *
 * The combined proxyStream() is kept for non-fallback use.
 *
 * NOTE: Provider-specific usage extraction (OpenAI / Anthropic / Gemini) is handled inside
 * extractStreamUsageUniversal() as inline branches rather than separate per-provider adapter
 * files. The stream forwarding is provider-agnostic; only the ~85-line usage parser has
 * provider awareness, which doesn't justify the overhead of 3+ files + barrel for ~25 lines each.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { log } from "@/server/lib/logger";
import { enqueueJob } from "@/server/lib/write-queue";
import { removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import type { ProviderAdapter, TokenUsage } from "../providers/types";

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

export interface StreamRelayMeta {
  keyId: number;
  providerId: string;
  modelId: string;
  requestId: string;
  start: number;
  inputPrice?: string;
  outputPrice?: string;
  /** Serialized request body — passed through for request logging. */
  requestBody?: string;
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

// ── Stage 1: Fetch upstream (retryable) ─────────────────────────────

/**
 * Attempt to fetch the upstream AI provider. Returns the Response object.
 * Throws on network error. Does NOT commit SSE headers to the client.
 */
export async function fetchUpstream(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = STREAM_MAX_DURATION_MS,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
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
  adapter: ProviderAdapter,
  meta: StreamRelayMeta,
  onComplete?: StreamCompleteCallback,
): Response {
  const abortController = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  /** Abort stream + cancel the upstream reader (unblocks pending read). */
  const cancelAll = () => {
    abortController.abort();
    activeReader?.cancel().catch(() => {});
  };

  const maxTimer = setTimeout(cancelAll, STREAM_MAX_DURATION_MS);
  let idleTimer = setTimeout(cancelAll, STREAM_IDLE_TIMEOUT_MS);

  return streamSSE(c, async (stream) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    stream.onAbort(() => {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      if (heartbeat) clearInterval(heartbeat);
      cancelAll();
    });

    if (!upstreamRes.body) {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      await stream.writeSSE({ data: JSON.stringify({ error: "No response body from upstream" }) });
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
      while (!stream.aborted && !abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        // Reset idle timer — upstream is still sending data
        clearTimeout(idleTimer);
        idleTimer = setTimeout(cancelAll, STREAM_IDLE_TIMEOUT_MS);

        buffer += decoder.decode(value, { stream: true });

        // M3: Guard against unbounded buffer growth
        if (buffer.length > MAX_BUFFER_SIZE) {
          log.gateway.error({ provider: meta.providerId }, "AI relay SSE buffer overflow");
          break;
        }

        const frames = splitSSEFrames(buffer);
        buffer = frames.remainder;

        for (const frame of frames.complete) {
          if (captureResponse) responseChunks.push(frame);

          const dataLine = extractDataLine(frame);
          if (dataLine === null) continue;

          if (adapter.isStreamDone(dataLine)) {
            await stream.writeSSE({ data: "[DONE]" });
            sentDone = true;
            break;
          }

          // M1: Accumulate usage — adapter first, universal fallback second
          const frameUsage =
            adapter.extractStreamUsage(dataLine) ?? extractStreamUsageUniversal(dataLine);
          if (frameUsage) {
            usage = usage
              ? {
                  inputTokens: usage.inputTokens + frameUsage.inputTokens,
                  outputTokens: usage.outputTokens + frameUsage.outputTokens,
                  totalTokens: usage.totalTokens + frameUsage.totalTokens,
                }
              : frameUsage;
          }

          const transformed = adapter.transformStreamEvent(dataLine);
          if (transformed !== null) {
            await stream.writeSSE({ data: transformed });
          }
        }
      }

      // M6: Send synthetic [DONE] if the adapter never triggered it (e.g., Gemini)
      if (!sentDone && !stream.aborted) {
        await stream.writeSSE({ data: "[DONE]" });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        log.gateway.error(
          { err, provider: meta.providerId, model: meta.modelId },
          "AI relay stream read error",
        );
      }
    } finally {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      if (heartbeat) clearInterval(heartbeat);
      reader.releaseLock();

      const latencyMs = Date.now() - meta.start;
      const rawResponse = captureResponse ? responseChunks.join("\n\n") : undefined;

      if (onComplete) {
        // Consumer relay handles its own usage logging (with consumerKeyId + markup cost)
      } else {
        // Admin relay — log usage here
        const cost = calculateCost(usage, meta);
        enqueueUsageLog(meta, upstreamRes.status, latencyMs, usage, undefined, cost);
        enqueueJob("ai-key-touch", {
          keyId: meta.keyId,
          keyType: "admin",
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
 * Used by generic `/v1/*` passthrough routes that don't know the provider format.
 * Same resilience features as forwardStream: idle timeout, heartbeat, reader cancel.
 */
export function forwardPassthroughStream(
  c: Context,
  upstreamRes: Response,
  meta: StreamRelayMeta,
  onComplete?: StreamCompleteCallback,
): Response {
  const abortController = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const cancelAll = () => {
    abortController.abort();
    activeReader?.cancel().catch(() => {});
  };

  const maxTimer = setTimeout(cancelAll, STREAM_MAX_DURATION_MS);
  let idleTimer = setTimeout(cancelAll, STREAM_IDLE_TIMEOUT_MS);

  return streamSSE(c, async (stream) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    stream.onAbort(() => {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      if (heartbeat) clearInterval(heartbeat);
      cancelAll();
    });

    if (!upstreamRes.body) {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      await stream.writeSSE({ data: JSON.stringify({ error: "No response body from upstream" }) });
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
      while (!stream.aborted && !abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        // Reset idle timer — upstream is still sending data
        clearTimeout(idleTimer);
        idleTimer = setTimeout(cancelAll, STREAM_IDLE_TIMEOUT_MS);

        buffer += decoder.decode(value, { stream: true });

        if (buffer.length > MAX_BUFFER_SIZE) {
          log.gateway.error({ provider: meta.providerId }, "AI passthrough SSE buffer overflow");
          break;
        }

        const frames = splitSSEFrames(buffer);
        buffer = frames.remainder;

        for (const frame of frames.complete) {
          if (captureResponse) responseChunks.push(frame);

          // Extract usage from data lines (universal: OpenAI/Anthropic/Gemini)
          const dataLine = extractDataLine(frame);
          if (dataLine !== null) {
            const frameUsage = extractStreamUsageUniversal(dataLine);
            if (frameUsage) {
              usage = usage
                ? {
                    inputTokens: usage.inputTokens + frameUsage.inputTokens,
                    outputTokens: usage.outputTokens + frameUsage.outputTokens,
                    totalTokens: usage.totalTokens + frameUsage.totalTokens,
                  }
                : frameUsage;
            }
          }

          // Forward the entire raw frame (preserving event:, data:, etc.)
          await stream.write(`${frame}\n\n`);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        log.gateway.error(
          { err, provider: meta.providerId, model: meta.modelId },
          "AI passthrough stream read error",
        );
      }
    } finally {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      if (heartbeat) clearInterval(heartbeat);
      reader.releaseLock();

      const latencyMs = Date.now() - meta.start;
      const rawResponse = captureResponse ? responseChunks.join("\n\n") : undefined;

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
        enqueueJob("ai-key-touch", {
          keyId: meta.keyId,
          keyType: "admin",
        });
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Retryable upstream status codes for fallback. */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Extract token usage from a raw JSON response string.
 * Supports both OpenAI (`usage.prompt_tokens`) and Anthropic (`usage.input_tokens`) shapes.
 * Used by generic passthrough routes that don't have a ProviderAdapter.
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

    // OpenAI Chat Completions shape: prompt_tokens / completion_tokens
    const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
    // Anthropic / OpenAI Responses API shape: input_tokens / output_tokens
    const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;

    const inputTokens = prompt || input;
    const outputTokens = completion || output;

    if (inputTokens === 0 && outputTokens === 0) return null;
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  } catch {
    return null;
  }
}

/**
 * Extract token usage from a single SSE data line without knowing the provider format.
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
      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      return inputTokens > 0 ? { inputTokens, outputTokens: 0, totalTokens: inputTokens } : null;
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
      if (usage) {
        const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        if (input > 0 || output > 0) {
          return { inputTokens: input, outputTokens: output, totalTokens: input + output };
        }
      }
      return null;
    }
    // Skip other OpenAI Responses API events without usage
    if (eventType?.startsWith("response.")) return null;

    // ── OpenAI Chat Completions: usage at top level (final chunk) ──
    // {"usage":{"prompt_tokens":9,"completion_tokens":5,"total_tokens":14}}
    const topUsage = obj.usage as Record<string, unknown> | undefined;
    if (topUsage) {
      const prompt = typeof topUsage.prompt_tokens === "number" ? topUsage.prompt_tokens : 0;
      const completion =
        typeof topUsage.completion_tokens === "number" ? topUsage.completion_tokens : 0;
      if (prompt > 0 || completion > 0) {
        return {
          inputTokens: prompt,
          outputTokens: completion,
          totalTokens: prompt + completion,
        };
      }
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
    keyId: meta.keyId,
    providerId: meta.providerId,
    modelId: meta.modelId,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    estimatedCost: estimatedCost ?? null,
    latencyMs,
    statusCode,
    requestId: meta.requestId,
    error: error ?? null,
  } as Record<string, unknown>);
}
