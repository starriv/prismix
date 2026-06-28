/**
 * In-memory credential assignment pool — weighted round-robin per endpoint.
 *
 * The relay authenticates through endpoint credentials because the same model can
 * be served by multiple protocol endpoints with different auth formats.
 */
import { log } from "@/server/lib/logger";
import { aiEndpointCredentialRepo, aiEndpointRepo, type EndpointCredential } from "@/server/repos";

// ── Types ────────────────────────────────────────────────────────────

interface PoolEntry {
  credential: EndpointCredential;
  weight: number;
  currentWeight: number; // for smooth weighted round-robin (SWRR)
}

interface Pool {
  entries: PoolEntry[];
  totalWeight: number;
  strategy: BalancerStrategy;
  loadedAt: number;
}

interface CredentialHealth {
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: number | null;
  penaltyUntil: number;
}

export type BalancerStrategy = "round-robin" | "random";

// ── State ────────────────────────────────────────────────────────────

/** Pool cache: "endpointId:upstreamId|official" → Pool */
const pools = new Map<string, Pool>();
const pendingLoads = new Map<string, Promise<Pool>>();
const credentialHealth = new Map<number, CredentialHealth>();
const credentialKeyHealth = new Map<number, CredentialHealth>();
const credentialIdByAssignment = new Map<number, number>();
let poolCacheVersion = 0;

const BASE_PENALTY_MS = 30_000;
const MAX_PENALTY_MS = 2 * 60 * 1000;
const DEFAULT_POOL_TTL_MS = 30_000;
const MIN_POOL_TTL_MS = 1_000;
const MAX_POOL_TTL_MS = 5 * 60 * 1000;

function readPoolTtlMs(): number {
  const raw = process.env.AI_CREDENTIAL_POOL_CACHE_TTL_MS ?? process.env.AI_KEY_POOL_CACHE_TTL_MS;
  if (!raw) return DEFAULT_POOL_TTL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.pricing.warn(
      { value: raw, fallbackMs: DEFAULT_POOL_TTL_MS },
      "Invalid AI credential pool cache TTL; using default",
    );
    return DEFAULT_POOL_TTL_MS;
  }

  return Math.min(Math.max(Math.trunc(parsed), MIN_POOL_TTL_MS), MAX_POOL_TTL_MS);
}

const POOL_TTL_MS = readPoolTtlMs();

function poolKey(endpointId: number, upstreamId: number | null): string {
  return `${endpointId}:${upstreamId ?? "official"}`;
}

function getOrCreateHealth(id: number, map: Map<number, CredentialHealth>): CredentialHealth {
  let state = map.get(id);
  if (!state) {
    state = {
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastFailureAt: null,
      penaltyUntil: 0,
    };
    map.set(id, state);
  }
  return state;
}

function getCredentialHealthState(endpointCredentialId: number): CredentialHealth {
  return getOrCreateHealth(endpointCredentialId, credentialHealth);
}

function getEffectiveWeight(entry: PoolEntry, now = Date.now()): number {
  const assignmentHealth = credentialHealth.get(entry.credential.id);
  const keyHealth = credentialKeyHealth.get(entry.credential.credentialId);
  const assignmentPenalty = assignmentHealth?.penaltyUntil ?? 0;
  const keyPenalty = keyHealth?.penaltyUntil ?? 0;
  const penaltyUntil = Math.max(assignmentPenalty, keyPenalty);
  if (penaltyUntil <= now) return entry.weight;
  const assignmentFailures = assignmentHealth?.consecutiveFailures ?? 0;
  const keyFailures = keyHealth?.consecutiveFailures ?? 0;
  const effectiveFailures = Math.max(assignmentFailures, keyFailures);
  return Math.max(1, Math.floor(entry.weight / (effectiveFailures + 1)));
}

// ── Pool loading ─────────────────────────────────────────────────────

async function loadPool(endpointId: number, upstreamId: number | null): Promise<Pool> {
  const config = await aiEndpointRepo.findBalancerConfig(endpointId);
  const strategy = (
    config?.loadBalanceStrategy === "random" ? "random" : "round-robin"
  ) as BalancerStrategy;

  const rows =
    upstreamId == null
      ? await aiEndpointCredentialRepo.findEnabledByEndpoint(endpointId)
      : await aiEndpointCredentialRepo.findEnabledByUpstream(endpointId, upstreamId);

  const entries: PoolEntry[] = rows.map((r) => {
    credentialIdByAssignment.set(r.id, r.credentialId);
    return {
      credential: r,
      weight: r.weight,
      currentWeight: 0,
    };
  });

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return { entries, totalWeight, strategy, loadedAt: Date.now() };
}

async function refreshPool(
  pk: string,
  endpointId: number,
  upstreamId: number | null,
): Promise<Pool> {
  const pending = pendingLoads.get(pk);
  if (pending) return pending;

  const loadVersion = poolCacheVersion;
  const nextLoad = loadPool(endpointId, upstreamId)
    .then((pool) => {
      if (loadVersion === poolCacheVersion) {
        pools.set(pk, pool);
      }
      return pool;
    })
    .finally(() => {
      pendingLoads.delete(pk);
    });

  pendingLoads.set(pk, nextLoad);
  return nextLoad;
}

async function getPool(endpointId: number, upstreamId: number | null): Promise<Pool> {
  const pk = poolKey(endpointId, upstreamId);
  let pool = pools.get(pk);
  const expired = pool ? Date.now() - pool.loadedAt >= POOL_TTL_MS : false;
  if (!pool || expired) {
    pool = await refreshPool(pk, endpointId, upstreamId);
  }
  return pool;
}

// ── Selection strategies ─────────────────────────────────────────────

/**
 * Smooth Weighted Round-Robin (SWRR) — Nginx-style.
 *
 * Each call:
 *   1. Add each entry's weight to its currentWeight
 *   2. Pick the entry with the highest currentWeight
 *   3. Subtract totalWeight from the picked entry's currentWeight
 *
 * Produces an even distribution proportional to weights with minimal clustering.
 */
function selectRoundRobin(pool: Pool): EndpointCredential | undefined {
  if (pool.entries.length === 0) return undefined;
  if (pool.entries.length === 1) return pool.entries[0].credential;

  let best: PoolEntry | null = null;
  let totalEffectiveWeight = 0;
  const now = Date.now();

  for (const entry of pool.entries) {
    const effectiveWeight = getEffectiveWeight(entry, now);
    totalEffectiveWeight += effectiveWeight;
    entry.currentWeight += effectiveWeight;
    if (!best || entry.currentWeight > best.currentWeight) {
      best = entry;
    }
  }

  if (!best) return undefined;
  best.currentWeight -= totalEffectiveWeight || pool.totalWeight;
  return best.credential;
}

/**
 * Weighted random — probabilistic selection proportional to weights.
 */
function selectRandom(pool: Pool): EndpointCredential | undefined {
  if (pool.entries.length === 0) return undefined;
  if (pool.entries.length === 1) return pool.entries[0].credential;

  const now = Date.now();
  const weightedEntries = pool.entries.map((entry) => ({
    entry,
    effectiveWeight: getEffectiveWeight(entry, now),
  }));
  const totalEffectiveWeight = weightedEntries.reduce((sum, item) => sum + item.effectiveWeight, 0);
  const rand = Math.random() * totalEffectiveWeight;
  let cumulative = 0;
  for (const item of weightedEntries) {
    cumulative += item.effectiveWeight;
    if (rand < cumulative) return item.entry.credential;
  }
  return pool.entries[pool.entries.length - 1].credential;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Pick the next credential assignment from an endpoint pool.
 * Strategy is read from the endpoint's `loadBalanceStrategy` column.
 */
export async function pickEndpointCredential(
  endpointId: number,
  upstreamId: number | null = null,
): Promise<EndpointCredential | undefined> {
  const pool = await getPool(endpointId, upstreamId);

  if (pool.entries.length === 0) return undefined;

  const credential = pool.strategy === "random" ? selectRandom(pool) : selectRoundRobin(pool);

  if (credential) {
    const health = credentialHealth.get(credential.id);
    log.pricing.debug(
      {
        endpointCredentialId: credential.id,
        credentialId: credential.credentialId,
        credentialName: credential.credentialName,
        endpointId,
        upstreamId,
        strategy: pool.strategy,
        poolSize: pool.entries.length,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        penaltyUntil: health?.penaltyUntil ?? 0,
      },
      "Endpoint credential selected from pool",
    );
  }

  return credential;
}

/**
 * Invalidate a specific endpoint credential pool.
 */
export function invalidateCredentialPool(endpointId: number, upstreamId?: number | null): void {
  poolCacheVersion++;
  if (upstreamId !== undefined) {
    pools.delete(poolKey(endpointId, upstreamId));
    return;
  }
  for (const key of pools.keys()) {
    if (key.startsWith(`${endpointId}:`)) pools.delete(key);
  }
}

/**
 * Clear all pools (call on shutdown or for testing).
 */
export function clearAllPools(): void {
  poolCacheVersion++;
  pools.clear();
  pendingLoads.clear();
  credentialHealth.clear();
  credentialKeyHealth.clear();
  credentialIdByAssignment.clear();
}

/**
 * Get pool info for display (UI shows pool size + next key indicator).
 */
export async function getPoolInfo(
  endpointId: number,
  upstreamId: number | null = null,
): Promise<{
  size: number;
  totalWeight: number;
  endpointCredentialIds: number[];
  penalizedEndpointCredentialIds: number[];
}> {
  const pool = await getPool(endpointId, upstreamId);
  return {
    size: pool.entries.length,
    totalWeight: pool.totalWeight,
    endpointCredentialIds: pool.entries.map((e) => e.credential.id),
    penalizedEndpointCredentialIds: pool.entries
      .filter((e) => {
        const now = Date.now();
        const assignmentPenalty = credentialHealth.get(e.credential.id)?.penaltyUntil ?? 0;
        const keyPenalty = credentialKeyHealth.get(e.credential.credentialId)?.penaltyUntil ?? 0;
        return Math.max(assignmentPenalty, keyPenalty) > now;
      })
      .map((e) => e.credential.id),
  };
}

export function markCredentialSuccess(endpointCredentialId: number): void {
  const state = getCredentialHealthState(endpointCredentialId);
  state.totalSuccesses++;
  state.consecutiveFailures = 0;
  state.penaltyUntil = 0;

  const credentialId = credentialIdByAssignment.get(endpointCredentialId);
  if (credentialId !== undefined) {
    const keyState = getOrCreateHealth(credentialId, credentialKeyHealth);
    keyState.totalSuccesses++;
    keyState.consecutiveFailures = 0;
    keyState.penaltyUntil = 0;
  }
}

export function markCredentialFailure(endpointCredentialId: number): void {
  const state = getCredentialHealthState(endpointCredentialId);
  state.totalFailures++;
  state.consecutiveFailures++;
  state.lastFailureAt = Date.now();
  const penaltyMs = Math.min(
    BASE_PENALTY_MS * 2 ** (state.consecutiveFailures - 1),
    MAX_PENALTY_MS,
  );
  state.penaltyUntil = Date.now() + penaltyMs;

  const credentialId = credentialIdByAssignment.get(endpointCredentialId);
  if (credentialId !== undefined) {
    const keyState = getOrCreateHealth(credentialId, credentialKeyHealth);
    keyState.totalFailures++;
    keyState.consecutiveFailures++;
    keyState.lastFailureAt = Date.now();
    const keyPenaltyMs = Math.min(
      BASE_PENALTY_MS * 2 ** (keyState.consecutiveFailures - 1),
      MAX_PENALTY_MS,
    );
    keyState.penaltyUntil = Date.now() + keyPenaltyMs;
  }
}

export function getCredentialHealthSnapshot(endpointCredentialId: number): CredentialHealth | null {
  const state = credentialHealth.get(endpointCredentialId);
  return state
    ? {
        consecutiveFailures: state.consecutiveFailures,
        totalFailures: state.totalFailures,
        totalSuccesses: state.totalSuccesses,
        lastFailureAt: state.lastFailureAt,
        penaltyUntil: state.penaltyUntil,
      }
    : null;
}
