/**
 * Upstream quota capture + cooldown integration helpers (Phase B-2 + B-3).
 *
 * Wraps the Phase B-1 foundation (captureQuotaSnapshot, repo methods, gauges)
 * into two call-site helpers:
 *
 * - `captureQuotaFromResponse()`: fire-and-forget — updates Redis cache +
 *   gauges, lifts cooldown early on 2xx. Never throws; never blocks the request.
 *
 * - `captureErrorQuota()`: fire-and-forgets `markCooldown` (the next candidate
 *   is a different credential, so awaiting provides no correctness benefit),
 *   then fire-and-forgets the snapshot update.
 *
 * - `filterAndSortByQuota()`: Phase B-2 cooldown filter + Phase B-3 quota-aware
 *   sort. Applied to resolved candidate lists before the retry loop. Also the
 *   single source of truth for the `upstreamCooldownActive` gauge.
 */
import { log } from "@/server/lib/logger";
import {
  upstreamCooldownActive,
  upstreamRateLimitRemainingRequests,
  upstreamRateLimitRemainingTokens,
} from "@/server/lib/metrics";
import { aiEndpointCredentialRepo } from "@/server/repos/ai-endpoint-credential-repo";

import type { ProtocolAdapter } from "../protocol-adapters/types";
import { captureQuotaSnapshot, type UpstreamQuotaSnapshot } from "./upstream-rate-limits";

type UpstreamProvider = UpstreamQuotaSnapshot["provider"];

const KNOWN_PROVIDERS = new Set<string>([
  "openai",
  "anthropic",
  "azure-openai",
  "gemini",
  "bedrock",
]);

function resolveProvider(adapter: ProtocolAdapter): UpstreamProvider | null {
  return KNOWN_PROVIDERS.has(adapter.format) ? (adapter.format as UpstreamProvider) : null;
}

const REDIS_TIMEOUT_MS = 50;

/**
 * Race a Redis promise against a timeout. On timeout, resolves with
 * `fallback` instead of rejecting — Redis slowness must not block request
 * routing for more than `REDIS_TIMEOUT_MS` ms.
 */
function withRedisTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), REDIS_TIMEOUT_MS)),
  ]);
}

/**
 * Capture quota from any upstream response (2xx, 4xx, 5xx).
 *
 * On 2xx, also clears cooldown — even if no rate-limit headers were returned
 * (e.g., Gemini/Bedrock success responses). A credential that was cooling down
 * and then succeeds must not stay in cooldown for the full TTL.
 *
 * On non-2xx, captures headers but does not clear cooldown (the caller's
 * `captureErrorQuota` handles cooldown marking on 429s).
 *
 * Fire-and-forget: updates Redis snapshot + Prometheus gauges synchronously.
 * Never throws — Redis failures are caught and logged at warn level.
 */
export function captureQuotaFromResponse(
  adapter: ProtocolAdapter,
  credentialId: number,
  response: Response,
): void {
  const provider = resolveProvider(adapter);
  if (!provider) return;
  const id = String(credentialId);

  if (response.ok) {
    aiEndpointCredentialRepo.clearCooldown(id, provider).catch((err) => {
      log.gateway.warn({ err, credentialId: id, provider }, "failed to clear upstream cooldown");
    });
  }

  const snapshot = captureQuotaSnapshot(adapter, id, provider, response);
  if (!snapshot) return;

  aiEndpointCredentialRepo.updateQuotaSnapshot(snapshot).catch((err) => {
    log.gateway.warn(
      { err, credentialId: id, provider },
      "Failed to update upstream quota snapshot",
    );
  });
  upstreamRateLimitRemainingRequests.set(
    { credentialId: id, provider },
    snapshot.remainingRequests ?? NaN,
  );
  upstreamRateLimitRemainingTokens.set(
    { credentialId: id, provider },
    snapshot.remainingTokens ?? NaN,
  );
}

/**
 * Capture quota from a 429 upstream response and apply cooldown.
 *
 * Parses the error body text as JSON (for Gemini's `quotaResetDelay`).
 * Fire-and-forgets `markCooldown` — the next candidate is a different
 * credential, so awaiting provides no correctness benefit. Then
 * fire-and-forgets the snapshot update + gauge set.
 *
 * Never throws — Redis failures are caught and logged.
 */
export async function captureErrorQuota(
  adapter: ProtocolAdapter,
  credentialId: number,
  response: Response,
  errorBodyText: string,
): Promise<void> {
  if (!adapter.parseRateLimitHeaders) return;
  const provider = resolveProvider(adapter);
  if (!provider) return;

  let errorBody: unknown = null;
  if (errorBodyText) {
    try {
      errorBody = JSON.parse(errorBodyText);
    } catch {
      // Not JSON — Gemini parser will return null (no quota metadata)
    }
  }

  const id = String(credentialId);
  const snapshot = captureQuotaSnapshot(adapter, id, provider, response, errorBody);
  if (!snapshot) return;

  if (snapshot.retryAfterMs != null && snapshot.retryAfterMs > 0) {
    aiEndpointCredentialRepo.markCooldown(id, provider, snapshot.retryAfterMs).catch((err) => {
      log.gateway.warn({ err, credentialId: id, provider }, "failed to mark upstream cooldown");
    });
  }

  aiEndpointCredentialRepo.updateQuotaSnapshot(snapshot).catch((err) => {
    log.gateway.warn(
      { err, credentialId: id, provider },
      "Failed to update upstream quota snapshot on 429",
    );
  });
  upstreamRateLimitRemainingRequests.set(
    { credentialId: id, provider },
    snapshot.remainingRequests ?? NaN,
  );
  upstreamRateLimitRemainingTokens.set(
    { credentialId: id, provider },
    snapshot.remainingTokens ?? NaN,
  );
}

/**
 * Phase B-2 + B-3: filter cooling-down candidates and sort by remaining quota.
 *
 * - Filters out candidates whose credential is in provider-requested cooldown.
 * - Sorts remaining candidates by `remainingRequests` (descending; unknown →
 *   `-Infinity` = lowest priority, tried last, after known-good credentials).
 * - If ALL candidates are cooling down, returns the original list unchanged
 *   (don't return an empty list — let the existing retry path handle it).
 *
 * Redis calls are wrapped with a 50ms timeout to prevent slow Redis from
 * blocking the request indefinitely. On timeout, `isCoolingDown` falls back
 * to `false` and `getQuotaSnapshot` falls back to `null`.
 *
 * The `upstreamCooldownActive` gauge is set here based on the actual
 * `isCoolingDown` result — this is the single source of truth for the gauge
 * (no longer set in `markCooldown`/`clearCooldown` to avoid stale-1 leaks
 * when Redis TTL expires without a callback).
 *
 * `credentialIdSelector` extracts the numeric endpoint-credential ID from
 * each item (different route types nest it at different paths).
 *
 * `providerSelector` extracts the adapter format string (e.g. "openai") used
 * for the gauge label. Must be a value in `KNOWN_PROVIDERS`; otherwise the
 * gauge is skipped for that candidate.
 */
export async function filterAndSortByQuota<T>(
  attempts: T[],
  credentialIdSelector: (attempt: T) => number,
  providerSelector: (attempt: T) => string,
): Promise<T[]> {
  if (attempts.length <= 1) return attempts;

  const cooldownChecks = await Promise.all(
    attempts.map(async (attempt) => {
      const id = String(credentialIdSelector(attempt));
      const rawProvider = providerSelector(attempt);
      const provider = KNOWN_PROVIDERS.has(rawProvider) ? (rawProvider as UpstreamProvider) : null;
      try {
        const coolingDown = await withRedisTimeout(
          aiEndpointCredentialRepo.isCoolingDown(id, rawProvider),
          false,
        );
        if (provider) {
          upstreamCooldownActive.set({ credentialId: id, provider }, coolingDown ? 1 : 0);
        }
        return { attempt, coolingDown };
      } catch (err) {
        log.gateway.warn(
          { err, credentialId: id },
          "Failed to check upstream cooldown — treating as not cooling down",
        );
        return { attempt, coolingDown: false };
      }
    }),
  );

  const active = cooldownChecks.filter((c) => !c.coolingDown);
  if (active.length === 0) return attempts;

  const withQuota = await Promise.all(
    active.map(async (entry) => {
      const id = String(credentialIdSelector(entry.attempt));
      try {
        const snapshot = await withRedisTimeout(
          aiEndpointCredentialRepo.getQuotaSnapshot(id),
          null,
        );
        const remaining =
          snapshot?.remainingRequests != null
            ? snapshot.remainingRequests
            : Number.NEGATIVE_INFINITY;
        return { attempt: entry.attempt, remaining };
      } catch (err) {
        log.gateway.warn(
          { err, credentialId: id },
          "Failed to read upstream quota snapshot — treating as unknown priority",
        );
        return { attempt: entry.attempt, remaining: Number.NEGATIVE_INFINITY };
      }
    }),
  );

  withQuota.sort((a, b) => b.remaining - a.remaining);
  return withQuota.map((w) => w.attempt);
}
