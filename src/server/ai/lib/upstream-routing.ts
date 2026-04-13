import type { AiProvider, AiProviderUpstream } from "@/server/db";
import { log } from "@/server/lib/logger";
import { weightedShuffle } from "@/server/lib/weighted-shuffle";
import { aiProviderUpstreamRepo } from "@/server/repos";

export interface UpstreamTarget {
  id: number | null;
  upstreamId: string;
  name: string;
  baseUrl: string;
  kind: string;
  priority: number;
  weight: number;
  isLegacy: boolean;
}

// ── Upstream candidate cache ────────────────────────────────────────

interface CachedUpstreams {
  targets: UpstreamTarget[];
  loadedAt: number;
}

const CACHE_TTL_MS = 30_000;

/**
 * Maximum number of upstream fetch attempts per single relay request.
 * Prevents excessive retry storms when many candidates are available.
 */
export const MAX_UPSTREAM_ATTEMPTS = 5;
const upstreamCache = new Map<number, CachedUpstreams>();

/**
 * Invalidate upstream cache for a provider.
 * Call after upstream CRUD operations.
 */
export function invalidateUpstreamCache(providerId: number): void {
  upstreamCache.delete(providerId);
}

/**
 * Clear all upstream caches (shutdown / testing).
 */
export function clearUpstreamCache(): void {
  upstreamCache.clear();
}

// ── Target builders ─────────────────────────────────────────────────

function toTarget(
  provider: AiProvider,
  upstream: AiProviderUpstream | null,
  priorityFallback = 1000,
): UpstreamTarget {
  if (!upstream) {
    return {
      id: null,
      upstreamId: "legacy",
      name: `${provider.name} Default`,
      baseUrl: provider.baseUrl,
      kind: "official",
      priority: priorityFallback,
      weight: 1,
      isLegacy: true,
    };
  }

  return {
    id: upstream.id,
    upstreamId: upstream.upstreamId,
    name: upstream.name,
    baseUrl: upstream.baseUrl,
    kind: upstream.kind,
    priority: upstream.priority,
    weight: upstream.weight,
    isLegacy: false,
  };
}

// ── Public API ──────────────────────────────────────────────────────

export async function resolveUpstreamCandidates(provider: AiProvider): Promise<UpstreamTarget[]> {
  const now = Date.now();
  const cached = upstreamCache.get(provider.id);

  let targets: UpstreamTarget[];

  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    // Clone so weighted-random shuffle doesn't mutate cache
    targets = [...cached.targets];
  } else {
    const upstreams = await aiProviderUpstreamRepo.findEnabledByProviderId(provider.id);
    const built = upstreams.map((upstream) => toTarget(provider, upstream));

    // Always include legacy target if no explicit upstreams exist,
    // so the relay still attempts provider.baseUrl and produces a clear error.
    if (built.length === 0) {
      built.push(toTarget(provider, null));
    } else if (provider.baseUrl) {
      built.push(toTarget(provider, null));
    }

    upstreamCache.set(provider.id, { targets: built, loadedAt: now });
    targets = [...built];
  }

  if (targets.length === 0) {
    log.gateway.warn(
      { providerId: provider.providerId },
      "No upstream candidates available (no upstreams configured and no baseUrl)",
    );
    return [];
  }

  if (targets.length <= 1) return targets;

  if (provider.upstreamRoutingStrategy === "weighted-random") {
    return weightedShuffle(targets, (t) => t.weight);
  }

  return targets.sort(
    (a, b) => a.priority - b.priority || b.weight - a.weight || a.name.localeCompare(b.name),
  );
}
