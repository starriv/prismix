/**
 * Per-upstream model ID mapping cache.
 *
 * Upstreams may use different model identifiers than the canonical gateway IDs.
 * This cache provides O(1) lookups with a 30-second TTL, matching the upstream
 * routing cache pattern.
 */
import { aiUpstreamModelMappingRepo } from "@/server/repos";

interface CachedMappings {
  mappings: Map<string, string>;
  loadedAt: number;
}

const cache = new Map<number, CachedMappings>();
const CACHE_TTL_MS = 30_000;

export async function resolveModelMapping(
  upstreamId: number | null,
  modelId: string,
): Promise<string> {
  if (!upstreamId) return modelId;

  const now = Date.now();
  let entry = cache.get(upstreamId);

  if (!entry || now - entry.loadedAt >= CACHE_TTL_MS) {
    const rows = await aiUpstreamModelMappingRepo.findEnabledByUpstreamId(upstreamId);
    const mappings = new Map<string, string>();
    for (const row of rows) {
      mappings.set(row.sourceModelId, row.mappedModelId);
    }
    entry = { mappings, loadedAt: now };
    cache.set(upstreamId, entry);
  }

  return entry.mappings.get(modelId) ?? modelId;
}

export function invalidateModelMappingCache(upstreamId: number): void {
  cache.delete(upstreamId);
}

export function clearModelMappingCache(): void {
  cache.clear();
}
