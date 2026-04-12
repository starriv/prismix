/**
 * Google Gemini adapter — bidirectional format conversion.
 *
 * Converts between the gateway's OpenAI-compatible format and Google's
 * Gemini API format. Handles:
 * - Request: messages → contents, system → systemInstruction, generationConfig
 * - Response: candidates[].content.parts → choices[].message.content
 * - Streaming: JSON chunks with candidates, no [DONE] signal (stream ends on reader done)
 * - URL: model-dependent (/models/{model}:generateContent or :streamGenerateContent)
 */
import crypto from "crypto";

import { match } from "ts-pattern";

import type {
  BuildUrlOptions,
  OpenAIChatBody,
  OpenAIChatResponse,
  ProviderAdapter,
  TokenUsage,
} from "./types";

// ── Gemini response types (minimal) ──────────────────────────────────

interface GeminiCandidate {
  content?: { role?: string; parts?: Array<{ text?: string; [key: string]: unknown }> };
  finishReason?: string;
  [key: string]: unknown;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
  modelVersion?: string;
  [key: string]: unknown;
}

// ── Finish reason mapping ────────────────────────────────────────────

function mapFinishReason(reason: string | undefined): string | null {
  if (!reason) return null;
  return match(reason)
    .with("STOP", () => "stop")
    .with("MAX_TOKENS", () => "length")
    .with("SAFETY", () => "content_filter")
    .with("RECITATION", () => "content_filter")
    .otherwise(() => reason.toLowerCase());
}

// ── Role mapping ─────────────────────────────────────────────────────

const INSTRUCTION_ROLES = new Set(["system", "developer"]);

function toGeminiRole(role: string): string {
  return match(role)
    .with("assistant", () => "model")
    .with("tool", () => "function")
    .otherwise(() => role);
}

// ── Adapter ──────────────────────────────────────────────────────────

export const geminiAdapter: ProviderAdapter = {
  format: "gemini",

  buildUrl(baseUrl: string, opts: BuildUrlOptions): string {
    const base = baseUrl.replace(/\/+$/, "");
    const method = opts.stream ? "streamGenerateContent" : "generateContent";
    const suffix = opts.stream ? "?alt=sse" : "";
    return `${base}/models/${opts.model}:${method}${suffix}`;
  },

  transformRequest(body: OpenAIChatBody): unknown {
    // Extract system/developer messages → systemInstruction
    const systemMessages = body.messages.filter((m) => INSTRUCTION_ROLES.has(m.role));
    const nonSystemMessages = body.messages.filter((m) => !INSTRUCTION_ROLES.has(m.role));

    const systemText = systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n\n");

    // Convert messages to Gemini contents format
    const contents = nonSystemMessages.map((m) => ({
      role: toGeminiRole(m.role),
      parts:
        typeof m.content === "string"
          ? [{ text: m.content }]
          : Array.isArray(m.content)
            ? m.content.map((part) => {
                if (typeof part === "string") return { text: part };
                const p = part as Record<string, unknown>;
                if (p.type === "text") return { text: p.text as string };
                return part;
              })
            : [{ text: "" }],
    }));

    // Build generationConfig from OpenAI params
    const generationConfig: Record<string, unknown> = {};
    if (body.max_tokens) generationConfig.maxOutputTokens = body.max_tokens;
    if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
    if (body.top_p !== undefined) generationConfig.topP = body.top_p;

    const result: Record<string, unknown> = { contents };

    if (systemText) {
      result.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (Object.keys(generationConfig).length > 0) {
      result.generationConfig = generationConfig;
    }

    // Pass through tools if present
    if (body.tools) {
      result.tools = body.tools;
    }

    return result;
  },

  transformResponse(body: unknown): OpenAIChatResponse {
    const res = body as GeminiResponse;
    const candidate = res.candidates?.[0];
    const textParts = candidate?.content?.parts?.filter((p) => p.text) ?? [];
    const content = textParts.length > 0 ? textParts.map((p) => p.text).join("") : null;

    const usage = res.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    return {
      id: `gemini-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: res.modelVersion ?? "",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: mapFinishReason(candidate?.finishReason),
        },
      ],
      usage: usage
        ? {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          }
        : undefined,
    };
  },

  extractUsage(body: unknown): TokenUsage | null {
    const res = body as GeminiResponse | null;
    const usage = res?.usageMetadata;
    if (!usage) return null;

    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  },

  transformStreamEvent(eventData: string): string | null {
    let chunk: GeminiResponse;
    try {
      chunk = JSON.parse(eventData) as GeminiResponse;
    } catch {
      return null;
    }

    const candidate = chunk.candidates?.[0];
    if (!candidate?.content?.parts) return null;

    const text = candidate.content.parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("");

    if (!text && !candidate.finishReason) return null;

    return JSON.stringify({
      choices: [
        {
          index: 0,
          delta: text ? { content: text } : {},
          finish_reason: mapFinishReason(candidate.finishReason),
        },
      ],
    });
  },

  extractStreamUsage(eventData: string): TokenUsage | null {
    try {
      const chunk = JSON.parse(eventData) as GeminiResponse;
      const usage = chunk.usageMetadata;
      if (!usage) return null;

      const inputTokens = usage.promptTokenCount ?? 0;
      const outputTokens = usage.candidatesTokenCount ?? 0;

      return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
    } catch {
      return null;
    }
  },

  // Gemini SSE does not send [DONE]. The stream ends when the ReadableStream reader returns done=true.
  // The stream-proxy while loop (line 112) already handles this correctly.
  isStreamDone(_eventData: string): boolean {
    return false;
  },
};
