/**
 * Semantic cache — hash-based exact match for AI relay responses.
 *
 * Phase 3: SHA-256 hash of messages → O(1) lookup via CacheStore (local LRU + Redis).
 * Phase 4 (future): embedding-based similarity search via RediSearch KNN.
 *
 * Cache key: ai-cache:{sha256(model + JSON.stringify(messages))}
 * Stored value: JSON-stringified OpenAI-compatible response.
 */
import crypto from "crypto";

import { type CacheStore, createCacheStore } from "@/server/cache";
import { log } from "@/server/lib/logger";

import type { OpenAIChatMessage } from "../providers/types";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10_000;

// Lazy initialization — CacheStore requires Redis to be connected,
// but this module is imported at route-registration time.
let _store: CacheStore<string> | null = null;

function getStore(): CacheStore<string> {
  if (!_store) _store = createCacheStore<string>("ai-cache", MAX_CACHE_SIZE);
  return _store;
}

// ── Public API ───────────────────────────────────────────────────────

/** Build a cache key from model + messages. */
export function buildCacheKey(model: string, messages: OpenAIChatMessage[]): string {
  const payload = JSON.stringify({ model, messages });
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
