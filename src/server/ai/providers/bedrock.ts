/**
 * AWS Bedrock adapter — delegates transforms to Anthropic adapter.
 *
 * Bedrock uses the Anthropic Messages API format for Claude models
 * but with a different URL pattern and SigV4 authentication.
 *
 * Phase 3: non-streaming only. Bedrock streaming uses binary
 * application/vnd.amazon.eventstream format (not SSE), which is a Phase 4 task.
 */
import { anthropicAdapter } from "./anthropic";
import type { BuildUrlOptions, ProviderAdapter } from "./types";

export const bedrockAdapter: ProviderAdapter = {
  format: "bedrock",

  buildUrl(baseUrl: string, opts: BuildUrlOptions): string {
    const base = baseUrl.replace(/\/+$/, "");
    // Non-streaming: /model/{model}/invoke
    // Streaming: /model/{model}/invoke-with-response-stream (Phase 4)
    const method = opts.stream ? "invoke-with-response-stream" : "invoke";
    return `${base}/model/${opts.model}/${method}`;
  },

  // All transform methods delegate to Anthropic (same Messages API format)
  transformRequest: anthropicAdapter.transformRequest,
  transformResponse: anthropicAdapter.transformResponse,
  extractUsage: anthropicAdapter.extractUsage,

  // Streaming: Bedrock uses binary eventstream, not SSE.
  // These methods are placeholders for Phase 4.
  transformStreamEvent: anthropicAdapter.transformStreamEvent,
  extractStreamUsage: anthropicAdapter.extractStreamUsage,
  isStreamDone: anthropicAdapter.isStreamDone,
};
