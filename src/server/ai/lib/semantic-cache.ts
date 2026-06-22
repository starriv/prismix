/**
 * Semantic cache — hash-based exact match for AI relay responses.
 *
 * Phase 3: SHA-256 hash of messages → O(1) lookup via CacheStore (local LRU + Redis).
 * Phase 4 (future): embedding-based similarity search via RediSearch KNN.
 *
 * Cache key: ai-cache:{sha256(stable JSON of scope + model + request + route)}
 * Stored value: JSON-stringified OpenAI-compatible response.
 */
import crypto from "crypto";

import { type CacheStore, createCacheStore } from "@/server/cache";
import { log } from "@/server/lib/logger";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10_000;

export interface SemanticCacheKeyInput {
  /** Caller scope, e.g. `admin` or `consumer:123`. */
  scope: string;
  /** Gateway-facing model ID. */
  model: string;
  /** Full normalized request body or serialized upstream body. */
  requestBody: unknown;
  providerId?: string | null;
  upstreamId?: number | null;
  upstreamBaseUrl?: string | null;
}

// Lazy initialization — CacheStore requires Redis to be connected,
// but this module is imported at route-registration time.
let _store: CacheStore<string> | null = null;

function getStore(): CacheStore<string> {
  if (!_store) _store = createCacheStore<string>("ai-cache", MAX_CACHE_SIZE);
  return _store;
}

// ── Public API ───────────────────────────────────────────────────────

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForHash(item));
  if (!value || typeof value !== "object") return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) normalized[key] = normalizeForHash(item);
  }
  return normalized;
}

/** Build a cache key from full request context. */
export function buildCacheKey(input: SemanticCacheKeyInput): string {
  const payload = JSON.stringify(normalizeForHash(input));
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  return `ai-cache:${hash}`;
}

/** Look up a cached response. Returns the parsed response or null on miss. */
export function getCachedResponse(key: string): unknown | null {
  const raw = getStore().get(key);
  if (!raw) return null;

  log.gateway.info({ cacheKey: key.slice(0, 40) }, "AI relay cache hit");
  return JSON.parse(raw);
}

/** Store a response in the cache. */
export function setCachedResponse(key: string, response: unknown, ttlMs = DEFAULT_TTL_MS): void {
  getStore().set(key, JSON.stringify(response), ttlMs);
}

/** Clear all cached entries. */
export function clearCache(): void {
  getStore().clear();
}

/** Get current cache size. */
export function getCacheSize(): number {
  return getStore().size();
}
