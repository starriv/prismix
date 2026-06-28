/**
 * Azure OpenAI adapter — delegates all transforms to the OpenAI adapter.
 *
 * Azure uses the same request/response format as OpenAI but with a different
 * URL pattern: /openai/deployments/{model}/chat/completions?api-version=...
 * Auth uses api-key header (configured via endpoint authConfig).
 */
import { openaiAdapter } from "./openai";
import type { BuildUrlOptions, ProtocolAdapter } from "./types";

const API_VERSION = "2024-02-01";

export const azureOpenaiAdapter: ProtocolAdapter = {
  format: "azure-openai",

  buildUrl(baseUrl: string, opts: BuildUrlOptions): string {
    const base = baseUrl.replace(/\/+$/, "");
    return `${base}/openai/deployments/${opts.model}/chat/completions?api-version=${API_VERSION}`;
  },

  // All transform methods delegate to the OpenAI adapter (same format)
  transformRequest: openaiAdapter.transformRequest,
  transformResponse: openaiAdapter.transformResponse,
  extractUsage: openaiAdapter.extractUsage,
  transformStreamEvent: openaiAdapter.transformStreamEvent,
  extractStreamUsage: openaiAdapter.extractStreamUsage,
  isStreamDone: openaiAdapter.isStreamDone,
};
