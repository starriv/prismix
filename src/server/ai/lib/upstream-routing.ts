import type { AiProvider } from "@/server/db";
import { log } from "@/server/lib/logger";
import { weightedShuffle } from "@/server/lib/weighted-shuffle";
import { aiUpstreamAssignmentRepo, type AssignmentWithUpstream } from "@/server/repos";

export interface UpstreamTarget {
  id: number | null;
  upstreamId: string;
  name: string;
  baseUrl: string;
  kind: string;
  modelsEndpoint: string | null;
  concurrencyLimit: number | null;
  queueTimeoutMs: number;
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
 * Call after assignment CRUD operations.
 */
export function invalidateUpstreamCache(providerId: number): void {
  upstreamCache.delete(providerId);
}

/**
 * Invalidate upstream cache for all providers assigned to a global upstream.
 * Call after global upstream update/delete.
 */
export async function invalidateUpstreamCacheForUpstream(upstreamId: number): Promise<void> {
  const assignments = await aiUpstreamAssignmentRepo.findByUpstreamId(upstreamId);
  for (const assignment of assignments) {
    upstreamCache.delete(assignment.providerId);
  }
}

/**
 * Clear all upstream caches (shutdown / testing).
 */
export function clearUpstreamCache(): void {
  upstreamCache.clear();
}

// ── Target builders ─────────────────────────────────────────────────

function toTarget(provider: AiProvider, assignment: AssignmentWithUpstream): UpstreamTarget {
  return {
    id: assignment.upstream.id,
    upstreamId: assignment.upstream.upstreamId,
    name: assignment.upstream.name,
    baseUrl: assignment.upstream.baseUrl,
    kind: assignment.upstream.kind,
    modelsEndpoint: assignment.upstream.modelsEndpoint ?? null,
    concurrencyLimit: assignment.upstream.concurrencyLimit ?? null,
    queueTimeoutMs: assignment.upstream.queueTimeoutMs,
    priority: assignment.priority,
    weight: assignment.weight,
    isLegacy: false,
  };
}

function toLegacyTarget(provider: AiProvider, priorityFallback = 1000): UpstreamTarget {
  return {
    id: null,
    upstreamId: "legacy",
    name: `${provider.name} Default`,
    baseUrl: provider.baseUrl,
    kind: "official",
    modelsEndpoint: null,
    concurrencyLimit: null,
    queueTimeoutMs: 30_000,
    priority: priorityFallback,
    weight: 1,
    isLegacy: true,
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
    const assignments = await aiUpstreamAssignmentRepo.findEnabledByProviderId(provider.id);
    const built = assignments.map((a) => toTarget(provider, a));

    // Always include legacy target if no explicit upstreams exist,
    // so the relay still attempts provider.baseUrl and produces a clear error.
    if (built.length === 0) {
      built.push(toLegacyTarget(provider));
    } else if (provider.baseUrl) {
      built.push(toLegacyTarget(provider));
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
