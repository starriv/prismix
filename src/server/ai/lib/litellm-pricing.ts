/**
 * LiteLLM pricing catalog — global in-memory index of AI model pricing.
 *
 * Fetches the community-maintained LiteLLM pricing JSON from GitHub,
 * filters to chat models, and builds O(1) lookup indexes.
 *
 * Caching: Redis (24h TTL) → in-memory Map.
 * The catalog is NOT a runtime dependency — relay/billing reads prices from DB.
 * It is used at two ingestion points only:
 *   1. seed-providers.ts   — enrich default prices for new providers
 *   2. admin-ai.ts         — enrich discover-models response
 */
import { type CacheStore, createCacheStore } from "@/server/cache";
import { log } from "@/server/lib/logger";
import { removeTailingZero, safeMultipliedBy } from "@/shared/number";

// ── Types ────────────────────────────────────────────────────────────

interface LiteLLMRawEntry {
  input_cost_per_token?: number | null;
  output_cost_per_token?: number | null;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  litellm_provider?: string;
  mode?: string;
  supports_vision?: boolean;
  supports_function_calling?: boolean;
  supports_reasoning?: boolean;
  supports_native_streaming?: boolean;
}

export interface ModelPricing {
  modelId: string; // stripped slug ("gpt-4o", "llama-3.3-70b-versatile")
  litellmKey: string; // original key ("groq/llama-3.3-70b-versatile")
  provider: string; // our slug ("openai", "anthropic", "google", "deepseek", "groq")
  inputPricePerMTok: string; // per 1M tokens, decimal string
  outputPricePerMTok: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: string[];
}

// ── Constants ────────────────────────────────────────────────────────

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const FETCH_TIMEOUT_MS = 30_000;
const REDIS_CACHE_KEY = "litellm-catalog";
const REDIS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Map LiteLLM `litellm_provider` values to our provider slugs.
 * Only providers we support are included — everything else is dropped.
 */
const PROVIDER_MAP: Record<string, string> = {
  openai: "openai",
  "text-completion-openai": "openai",
  anthropic: "anthropic",
  gemini: "google",
  deepseek: "deepseek",
  groq: "groq",
  mistral: "mistral",
  xai: "xai",
  bedrock: "bedrock",
  bedrock_converse: "bedrock",
};

/**
 * Some LiteLLM keys use a prefix (e.g. "groq/llama-3.3-70b-versatile").
 * Map the prefix to our slug.
 */
const PREFIX_MAP: Record<string, string> = {
  groq: "groq",
  deepseek: "deepseek",
  gemini: "google",
  mistral: "mistral",
  xai: "xai",
};

// ── State (per-instance, eventually consistent via Redis-backed raw JSON) ──

/** model lookup: "openai:gpt-4o" → ModelPricing (per-instance parsed copy) */
let byProviderAndModel = new Map<string, ModelPricing>();
/** provider lookup: "openai" → ModelPricing[] (per-instance parsed copy) */
let byProvider = new Map<string, ModelPricing[]>();
let lastFetchedAt = 0;
let redisCache: CacheStore<string> | null = null;

// ── Price conversion ─────────────────────────────────────────────────

function toPerMTok(costPerToken: number | null | undefined): string {
  if (costPerToken == null || costPerToken === 0) return "0";
  return removeTailingZero(safeMultipliedBy(costPerToken, 1_000_000), 6);
}

// ── Capabilities derivation ──────────────────────────────────────────

function deriveCapabilities(entry: LiteLLMRawEntry): string[] {
  const caps: string[] = [];
  if (entry.mode === "chat") caps.push("chat");
  if (entry.supports_vision) caps.push("vision");
  if (entry.supports_function_calling) caps.push("tools");
  if (entry.supports_native_streaming !== false) caps.push("streaming");
  if (entry.supports_reasoning) caps.push("reasoning");
  return caps;
}

// ── Model ID + provider resolution ───────────────────────────────────

function resolveEntry(
  key: string,
  entry: LiteLLMRawEntry,
): { modelId: string; provider: string } | null {
  // Skip non-chat, image, embedding, etc.
  if (entry.mode && entry.mode !== "chat") return null;
  // Skip entries without pricing
  if (entry.input_cost_per_token == null && entry.output_cost_per_token == null) return null;

  const slashIdx = key.indexOf("/");

  if (slashIdx > 0) {
    // Prefixed key: "groq/llama-3.3-70b-versatile"
    const prefix = key.slice(0, slashIdx);
    const provider = PREFIX_MAP[prefix];
    if (!provider) return null;
    const modelId = key.slice(slashIdx + 1);
    return { modelId, provider };
  }

  // Non-prefixed key: "gpt-4o", "claude-sonnet-4-6"
  const provider = entry.litellm_provider ? PROVIDER_MAP[entry.litellm_provider] : undefined;
  if (!provider) return null;
  return { modelId: key, provider };
}

// ── Parse raw JSON into indexed Maps ─────────────────────────────────

function parseAndIndex(raw: Record<string, LiteLLMRawEntry>): {
  modelMap: Map<string, ModelPricing>;
  providerMap: Map<string, ModelPricing[]>;
  count: number;
} {
  const modelMap = new Map<string, ModelPricing>();
  const providerMap = new Map<string, ModelPricing[]>();
  let count = 0;

  for (const [key, entry] of Object.entries(raw)) {
    if (key === "sample_spec") continue;

    const resolved = resolveEntry(key, entry);
    if (!resolved) continue;

    const pricing: ModelPricing = {
      modelId: resolved.modelId,
      litellmKey: key,
      provider: resolved.provider,
      inputPricePerMTok: toPerMTok(entry.input_cost_per_token),
      outputPricePerMTok: toPerMTok(entry.output_cost_per_token),
      contextWindow: entry.max_input_tokens ?? null,
      maxOutputTokens: entry.max_output_tokens ?? null,
      capabilities: deriveCapabilities(entry),
    };

    const lookupKey = `${resolved.provider}:${resolved.modelId}`;
    // First entry wins (direct API entries come before hosted variants)
    if (!modelMap.has(lookupKey)) {
      modelMap.set(lookupKey, pricing);

      const arr = providerMap.get(resolved.provider) ?? [];
      arr.push(pricing);
      providerMap.set(resolved.provider, arr);
      count++;
    }
  }

  return { modelMap, providerMap, count };
}

// ── Fetch + cache ────────────────────────────────────────────────────

async function fetchFromGitHub(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(LITELLM_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      log.pricing.warn({ status: res.status }, "LiteLLM fetch failed");
      return null;
    }
    return await res.text();
  } catch (err) {
    log.pricing.warn({ err }, "LiteLLM fetch error");
    return null;
  }
}

function getCache(): CacheStore<string> {
  if (!redisCache) {
    redisCache = createCacheStore<string>("litellm");
  }
  return redisCache;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Fetch LiteLLM pricing data and rebuild the in-memory index.
 * Tries Redis cache first, falls back to GitHub fetch.
 */
export async function refreshLiteLLMPricing(): Promise<void> {
  let rawJson: string | null = null;

  // 1. Try Redis cache
  try {
    const cached = getCache().get(REDIS_CACHE_KEY);
    if (cached) {
      rawJson = cached;
      log.pricing.debug("Loaded LiteLLM catalog from Redis cache");
    }
  } catch {
    // Redis unavailable — proceed to fetch
  }

  // 2. Fetch from GitHub if cache miss
  if (!rawJson) {
    rawJson = await fetchFromGitHub();
    if (rawJson) {
      try {
        getCache().set(REDIS_CACHE_KEY, rawJson, REDIS_TTL_MS);
      } catch {
        // Redis write failed — non-critical
      }
    }
  }

  if (!rawJson) {
    log.pricing.warn("No LiteLLM data available (GitHub fetch failed, no Redis cache)");
    return;
  }

  // 3. Parse and rebuild indexes
  try {
    const raw = JSON.parse(rawJson) as Record<string, LiteLLMRawEntry>;
    const { modelMap, providerMap, count } = parseAndIndex(raw);
    byProviderAndModel = modelMap;
    byProvider = providerMap;
    lastFetchedAt = Date.now();
    log.pricing.info({ models: count, providers: providerMap.size }, "LiteLLM catalog refreshed");
  } catch (err) {
    log.pricing.error({ err }, "Failed to parse LiteLLM JSON");
  }
}

/**
 * Look up pricing for a specific model by our model slug + provider slug.
 */
export function lookupPricing(modelId: string, providerSlug: string): ModelPricing | undefined {
  return byProviderAndModel.get(`${providerSlug}:${modelId}`);
}

/**
 * Get all known models for a provider.
 */
export function getProviderModels(providerSlug: string): ModelPricing[] {
  return byProvider.get(providerSlug) ?? [];
}

/**
 * Whether the catalog has been loaded at least once.
 */
export function isCatalogReady(): boolean {
  return byProviderAndModel.size > 0;
}

/**
 * Timestamp of last successful catalog load (0 if never loaded).
 */
export function getLastFetchedAt(): number {
  return lastFetchedAt;
}

// ── Test helpers ─────────────────────────────────────────────────────

/** @internal — for unit tests only */
export { parseAndIndex as _parseAndIndex, toPerMTok as _toPerMTok, resolveEntry as _resolveEntry };
