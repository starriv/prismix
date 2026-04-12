/**
 * Shared request helpers for AI relay routes.
 *
 * - extractPassthroughHeaders: forward provider-specific headers from client to upstream
 * - isRequestLoggingEnabled: cached opt-in check for request/response body logging
 */
import type { Context } from "hono";

import { settingsRepo } from "@/server/repos";

// ── Passthrough Headers ────────────────────────────────────────────

/** Prefixes for headers to forward from client to upstream provider (not auth, not hop-by-hop). */
const PASSTHROUGH_PREFIXES = ["anthropic-", "openai-", "x-stainless-"];

/** Extract provider-specific headers from the incoming request to forward upstream. */
export function extractPassthroughHeaders(c: Context): Record<string, string> {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (PASSTHROUGH_PREFIXES.some((p) => lower.startsWith(p))) {
      headers[key] = value;
    }
  });
  return headers;
}

// ── Request Logging Opt-in ─────────────────────────────────────────

const loggingCache = { enabled: false, expiresAt: 0 };
const LOGGING_CACHE_TTL = 60_000;

/** Check if AI request/response body logging is enabled (cached with 60s TTL). */
export async function isRequestLoggingEnabled(): Promise<boolean> {
  if (loggingCache.expiresAt > Date.now()) return loggingCache.enabled;

  const value = await settingsRepo.getGlobal("ai_request_logging");
  const enabled = value === "enabled";
  loggingCache.enabled = enabled;
  loggingCache.expiresAt = Date.now() + LOGGING_CACHE_TTL;
  return enabled;
}
