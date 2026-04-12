/**
 * AWS Bedrock adapter — dynamic multi-vendor format dispatch.
 *
 * Bedrock hosts models from multiple vendors (Anthropic, MiniMax, Moonshot,
 * OpenAI, etc.) behind a single SigV4-authenticated endpoint. Each vendor
 * uses its own request/response format:
 *   - anthropic.* → Anthropic Messages API format
 *   - everything else → OpenAI-compatible format (passthrough)
 *
 * The adapter selects the correct delegate at runtime based on:
 *   - transformRequest: model ID from body.model
 *   - transformResponse / extractUsage: response body shape sniffing
 *   - streaming methods: event JSON shape sniffing
 *
 * URL pattern (all vendors): /model/{modelId}/invoke[-with-response-stream]
 */
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import type { BuildUrlOptions, OpenAIChatBody, ProviderAdapter, TokenUsage } from "./types";

// ── Vendor prefix extraction ────────────────────────────────────────

/** Known Bedrock cross-region inference prefixes (2–5 chars). */
const REGION_PREFIXES = new Set(["us", "eu", "ap", "apac", "global", "jp", "au", "ca", "us-gov"]);

/**
 * Extract the vendor segment from a Bedrock model ID.
 *
 * Examples:
 *   "anthropic.claude-opus-4-6-v1"         → "anthropic"
 *   "us.anthropic.claude-sonnet-4-6"       → "anthropic"
 *   "minimax.minimax-m2.1"                 → "minimax"
 *   "moonshot.kimi-k2.5"                   → "moonshot"
 */
export function getVendorPrefix(modelId: string): string {
  const parts = modelId.split(".");
  // Skip known cross-region prefix if present
  const start = parts.length > 2 && REGION_PREFIXES.has(parts[0]) ? 1 : 0;
  return parts[start] ?? modelId;
}

/** Returns true if the vendor uses Anthropic Messages API format. */
function isAnthropicVendor(modelId: string): boolean {
  return getVendorPrefix(modelId) === "anthropic";
}

// ── Response shape sniffing ─────────────────────────────────────────

/** Anthropic responses have `type: "message"` at the top level. */
function isAnthropicResponse(body: unknown): boolean {
  return (body as Record<string, unknown>)?.type === "message";
}

/** Anthropic stream events have `type` matching known Anthropic event names. */
const ANTHROPIC_EVENT_TYPES = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "ping",
  "error",
]);

function isAnthropicStreamEvent(eventData: string): boolean {
  try {
    const event = JSON.parse(eventData) as Record<string, unknown>;
    return typeof event.type === "string" && ANTHROPIC_EVENT_TYPES.has(event.type);
  } catch {
    return false;
  }
}

// ── Inference profile auto-prefix ────────────────────────────────────

/**
 * Extract the AWS region from a Bedrock runtime base URL.
 * e.g. "https://bedrock-runtime.us-east-1.amazonaws.com" → "us-east-1"
 */
function extractRegionFromUrl(baseUrl: string): string | null {
  const m = /bedrock-runtime\.([a-z0-9-]+)\.amazonaws/.exec(baseUrl);
  return m?.[1] ?? null;
}

/**
 * Map an AWS region code to the Bedrock cross-region inference geography prefix.
 * e.g. "us-east-1" → "us", "eu-central-1" → "eu", "ap-northeast-1" → "ap"
 */
function regionToGeoPrefix(region: string): string {
  const seg = region.split("-")[0]; // "us", "eu", "ap", "ca", "sa", "me", "af"
  return seg;
}

/**
 * Ensure the model ID has a cross-region inference profile prefix.
 * Newer Bedrock models require invoking via inference profiles (e.g. us.anthropic.claude-*)
 * rather than bare model IDs. If the model already has a geography prefix, return as-is.
 */
export function ensureInferenceProfile(modelId: string, baseUrl: string): string {
  // Already has a known geography prefix → no change
  const parts = modelId.split(".");
  if (parts.length > 2 && REGION_PREFIXES.has(parts[0])) return modelId;

  const region = extractRegionFromUrl(baseUrl);
  if (!region) return modelId;

  const geo = regionToGeoPrefix(region);
  return `${geo}.${modelId}`;
}

// ── Adapter ─────────────────────────────────────────────────────────

export const bedrockAdapter: ProviderAdapter = {
  format: "bedrock",

  buildUrl(baseUrl: string, opts: BuildUrlOptions): string {
    const base = baseUrl.replace(/\/+$/, "");
    const method = opts.stream ? "invoke-with-response-stream" : "invoke";
    const modelId = ensureInferenceProfile(opts.model, baseUrl);
    return `${base}/model/${modelId}/${method}`;
  },

  transformRequest(body: OpenAIChatBody): unknown {
    const delegate = isAnthropicVendor(body.model) ? anthropicAdapter : openaiAdapter;
    return delegate.transformRequest(body);
  },

  transformResponse(body: unknown): ReturnType<ProviderAdapter["transformResponse"]> {
    const delegate = isAnthropicResponse(body) ? anthropicAdapter : openaiAdapter;
    return delegate.transformResponse(body);
  },

  extractUsage(body: unknown): TokenUsage | null {
    const delegate = isAnthropicResponse(body) ? anthropicAdapter : openaiAdapter;
    return delegate.extractUsage(body);
  },

  transformStreamEvent(eventData: string): string | null {
    const delegate = isAnthropicStreamEvent(eventData) ? anthropicAdapter : openaiAdapter;
    return delegate.transformStreamEvent(eventData);
  },

  extractStreamUsage(eventData: string): TokenUsage | null {
    const delegate = isAnthropicStreamEvent(eventData) ? anthropicAdapter : openaiAdapter;
    return delegate.extractStreamUsage(eventData);
  },

  isStreamDone(eventData: string): boolean {
    // Both: OpenAI uses "[DONE]", Anthropic uses {type: "message_stop"}
    return openaiAdapter.isStreamDone(eventData) || anthropicAdapter.isStreamDone(eventData);
  },
};
