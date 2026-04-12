/**
 * Provider Adapter types — defines the contract for AI provider format adapters.
 *
 * Each adapter handles request/response format conversion between the
 * OpenAI-compatible relay input and the provider's native API format.
 */

// ── Token usage ──────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Anthropic: tokens written to prompt cache (billed at 1.25× input rate). */
  cacheCreationInputTokens?: number;
  /** Anthropic: tokens read from prompt cache (billed at 0.1× input rate). */
  cacheReadInputTokens?: number;
}

// ── OpenAI-compatible shapes ─────────────────────────────────────────

/** Minimal OpenAI chat message shape (passthrough extra fields). */
export interface OpenAIChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | unknown[] | null;
  [key: string]: unknown;
}

/** OpenAI-compatible chat completion request body. */
export interface OpenAIChatBody {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  [key: string]: unknown;
}

/** OpenAI-compatible chat completion response (non-streaming). */
export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; [key: string]: unknown };
    finish_reason: string | null;
    [key: string]: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Provider Adapter interface ───────────────────────────────────────

export interface ProviderAdapter {
  /** Provider API format identifier (e.g., "openai", "anthropic", "gemini"). */
  readonly format: string;

  /** Transform OpenAI-compatible request body to provider native format. */
  transformRequest(body: OpenAIChatBody): unknown;

  /** Transform provider native response to OpenAI-compatible format. */
  transformResponse(body: unknown): OpenAIChatResponse;

  /** Extract token usage from a non-streaming response body. */
  extractUsage(body: unknown): TokenUsage | null;

  /**
   * Transform a single SSE event data line from provider format to OpenAI format.
   * Return null to skip (not forward) this event.
   */
  transformStreamEvent(eventData: string): string | null;

  /** Extract token usage from a streaming SSE event data line (typically the final chunk). */
  extractStreamUsage(eventData: string): TokenUsage | null;

  /** Check if an SSE event data line signals end of stream. */
  isStreamDone(eventData: string): boolean;

  /** Build the upstream request URL from the provider's base URL. */
  buildUrl(baseUrl: string, opts: BuildUrlOptions): string;
}

/** Options passed to buildUrl for model-dependent URL construction. */
export interface BuildUrlOptions {
  /** The model ID from the request (e.g., "gpt-4o", "gemini-2.5-flash"). */
  model: string;
  /** Whether this is a streaming request. */
  stream: boolean;
}
