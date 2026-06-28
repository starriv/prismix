import type { AiEndpoint } from "@/server/db";
import { log } from "@/server/lib/logger";
import { weightedShuffle } from "@/server/lib/weighted-shuffle";
import { aiUpstreamAssignmentRepo, type AssignmentWithUpstream } from "@/server/repos";

import {
  resolveConnectorRuntimeConfig,
  type SupplierRuntimeDefaults,
} from "./connector-runtime-config";

export interface UpstreamTarget {
  id: number | null;
  upstreamId: string;
  concurrencyScopeKey: string;
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

type RoutableEndpoint = AiEndpoint & {
  supplier?: SupplierRuntimeDefaults | null;
};

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
 * Invalidate upstream cache for an endpoint.
 * Call after assignment CRUD operations.
 */
export function invalidateUpstreamCache(endpointId: number): void {
  upstreamCache.delete(endpointId);
}

/**
 * Invalidate upstream cache for all endpoints assigned to a global upstream.
 * Call after global upstream update/delete.
 */
export async function invalidateUpstreamCacheForUpstream(upstreamId: number): Promise<void> {
  const assignments = await aiUpstreamAssignmentRepo.findByUpstreamId(upstreamId);
  for (const assignment of assignments) {
    upstreamCache.delete(assignment.endpointId);
  }
}

/**
 * Clear all upstream caches (shutdown / testing).
 */
export function clearUpstreamCache(): void {
  upstreamCache.clear();
}

// ── Target builders ─────────────────────────────────────────────────

function toTarget(assignment: AssignmentWithUpstream): UpstreamTarget {
  return {
    id: assignment.upstream.id,
    upstreamId: assignment.upstream.upstreamId,
    concurrencyScopeKey: String(assignment.upstream.id),
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

function toOfficialTarget(endpoint: RoutableEndpoint, priorityFallback = 1000): UpstreamTarget {
  const runtime = resolveConnectorRuntimeConfig(endpoint);

  return {
    id: null,
    upstreamId: "official",
    concurrencyScopeKey: `endpoint:${endpoint.id}:official`,
    name: `${endpoint.name} Official`,
    baseUrl: endpoint.baseUrl,
    kind: "official",
    modelsEndpoint: null,
    concurrencyLimit: runtime.officialConcurrencyLimit ?? null,
    queueTimeoutMs: runtime.officialQueueTimeoutMs,
    priority: priorityFallback,
    weight: 1,
    isLegacy: true,
  };
}

// ── Public API ──────────────────────────────────────────────────────

export async function resolveUpstreamCandidates(
  endpoint: RoutableEndpoint,
): Promise<UpstreamTarget[]> {
  const now = Date.now();
  const cached = upstreamCache.get(endpoint.id);

  let targets: UpstreamTarget[];

  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    // Clone so weighted-random shuffle doesn't mutate cache
    targets = [...cached.targets];
  } else {
    const assignments = await aiUpstreamAssignmentRepo.findEnabledByEndpointId(endpoint.id);
    const built = assignments.map(toTarget);

    // Always include the official target if no explicit upstreams exist,
    // so the relay still attempts endpoint.baseUrl and produces a clear error.
    if (built.length === 0) {
      built.push(toOfficialTarget(endpoint));
    } else if (endpoint.baseUrl) {
      built.push(toOfficialTarget(endpoint));
    }

    upstreamCache.set(endpoint.id, { targets: built, loadedAt: now });
    targets = [...built];
  }

  if (targets.length === 0) {
    log.gateway.warn(
      { endpointId: endpoint.endpointId },
      "No upstream candidates available (no upstreams configured and no baseUrl)",
    );
    return [];
  }

  if (targets.length <= 1) return targets;

  if (endpoint.upstreamRoutingStrategy === "weighted-random") {
    return weightedShuffle(targets, (t) => t.weight);
  }

  return targets.sort(
    (a, b) => a.priority - b.priority || b.weight - a.weight || a.name.localeCompare(b.name),
  );
}
