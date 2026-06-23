/**
 * In-memory key pool balancer — weighted round-robin for AI keys.
 *
 * Solves the async write-queue race condition where DB-based LRU (`last_used_at`)
 * can't keep up with rapid sequential requests. The balancer maintains an in-memory
 * counter per provider pool and rotates keys synchronously.
 *
 * Two strategies:
 *   - round-robin (default): deterministic weighted rotation via smooth weighted round-robin
 *   - random: probabilistic weighted selection
 *
 * The pool is lazily initialized from DB on first access, invalidated on key CRUD,
 * and refreshed after a short TTL so direct DB repairs or missed invalidation events
 * cannot leave a running process pinned to a stale empty key pool.
 */
import type { AiKey } from "@/server/db";
import { log } from "@/server/lib/logger";
import { aiKeyRepo, aiProviderRepo } from "@/server/repos";

// ── Types ────────────────────────────────────────────────────────────

interface PoolEntry {
  key: AiKey;
  weight: number;
  currentWeight: number; // for smooth weighted round-robin (SWRR)
}

interface Pool {
  entries: PoolEntry[];
  totalWeight: number;
  strategy: BalancerStrategy;
  loadedAt: number;
}

interface KeyHealth {
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: number | null;
  penaltyUntil: number;
}

export type BalancerStrategy = "round-robin" | "random";

// ── State ────────────────────────────────────────────────────────────

/** Pool cache: "providerId" → Pool */
const pools = new Map<string, Pool>();
const pendingLoads = new Map<string, Promise<Pool>>();
const keyHealth = new Map<number, KeyHealth>();
let poolCacheVersion = 0;

const BASE_PENALTY_MS = 30_000;
const MAX_PENALTY_MS = 2 * 60 * 1000;
const DEFAULT_POOL_TTL_MS = 30_000;
const MIN_POOL_TTL_MS = 1_000;
const MAX_POOL_TTL_MS = 5 * 60 * 1000;

function readPoolTtlMs(): number {
  const raw = process.env.AI_KEY_POOL_CACHE_TTL_MS;
  if (!raw) return DEFAULT_POOL_TTL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.pricing.warn(
      { value: raw, fallbackMs: DEFAULT_POOL_TTL_MS },
      "Invalid AI key pool cache TTL; using default",
    );
    return DEFAULT_POOL_TTL_MS;
  }

  return Math.min(Math.max(Math.trunc(parsed), MIN_POOL_TTL_MS), MAX_POOL_TTL_MS);
}

const POOL_TTL_MS = readPoolTtlMs();

function poolKey(providerId: number, upstreamId: number | null): string {
  return `${providerId}:${upstreamId ?? "legacy"}`;
}

function getKeyHealthState(keyId: number): KeyHealth {
  let state = keyHealth.get(keyId);
  if (!state) {
    state = {
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastFailureAt: null,
      penaltyUntil: 0,
    };
    keyHealth.set(keyId, state);
  }
  return state;
}

function getEffectiveWeight(entry: PoolEntry, now = Date.now()): number {
  const health = keyHealth.get(entry.key.id);
  if (!health || health.penaltyUntil <= now) return entry.weight;
  return Math.max(1, Math.floor(entry.weight / (health.consecutiveFailures + 1)));
}

// ── Pool loading ─────────────────────────────────────────────────────

async function loadPool(providerId: number, upstreamId: number | null): Promise<Pool> {
  // Load provider strategy
  const config = await aiProviderRepo.findBalancerConfig(providerId);
  const strategy = (
    config?.loadBalanceStrategy === "random" ? "random" : "round-robin"
  ) as BalancerStrategy;

  const rows =
    upstreamId == null
      ? await aiKeyRepo.findEnabledByProvider(providerId)
      : await aiKeyRepo.findEnabledByUpstream(providerId, upstreamId);

  const entries: PoolEntry[] = rows.map((r) => ({
    key: r,
    weight: r.weight,
    currentWeight: 0,
  }));

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return { entries, totalWeight, strategy, loadedAt: Date.now() };
}

async function refreshPool(
  pk: string,
  providerId: number,
  upstreamId: number | null,
): Promise<Pool> {
  const pending = pendingLoads.get(pk);
  if (pending) return pending;

  const loadVersion = poolCacheVersion;
  const nextLoad = loadPool(providerId, upstreamId)
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

async function getPool(providerId: number, upstreamId: number | null): Promise<Pool> {
  const pk = poolKey(providerId, upstreamId);
  let pool = pools.get(pk);
  const expired = pool ? Date.now() - pool.loadedAt >= POOL_TTL_MS : false;
  if (!pool || expired) {
    pool = await refreshPool(pk, providerId, upstreamId);
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
function selectRoundRobin(pool: Pool): AiKey | undefined {
  if (pool.entries.length === 0) return undefined;
  if (pool.entries.length === 1) return pool.entries[0].key;

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
  return best.key;
}

/**
 * Weighted random — probabilistic selection proportional to weights.
 */
function selectRandom(pool: Pool): AiKey | undefined {
  if (pool.entries.length === 0) return undefined;
  if (pool.entries.length === 1) return pool.entries[0].key;

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
    if (rand < cumulative) return item.entry.key;
  }
  return pool.entries[pool.entries.length - 1].key;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Pick the next key from a provider pool.
 * Strategy is read from the provider's `loadBalanceStrategy` column.
 * Returns undefined if no enabled keys with weight > 0 exist.
 */
export async function pickKey(
  providerId: number,
  upstreamId: number | null = null,
): Promise<AiKey | undefined> {
  const pool = await getPool(providerId, upstreamId);

  if (pool.entries.length === 0) return undefined;

  const key = pool.strategy === "random" ? selectRandom(pool) : selectRoundRobin(pool);

  if (key) {
    const health = keyHealth.get(key.id);
    log.pricing.debug(
      {
        keyId: key.id,
        keyName: key.name,
        strategy: pool.strategy,
        poolSize: pool.entries.length,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        penaltyUntil: health?.penaltyUntil ?? 0,
      },
      "Key selected from pool",
    );
  }

  return key;
}

/**
 * Invalidate a specific provider pool (call after key CRUD).
 * Next `pickKey` call will reload from DB.
 */
export function invalidateKeyPool(providerId: number, upstreamId?: number | null): void {
  poolCacheVersion++;
  if (upstreamId !== undefined) {
    pools.delete(poolKey(providerId, upstreamId));
    return;
  }
  for (const key of pools.keys()) {
    if (key.startsWith(`${providerId}:`)) pools.delete(key);
  }
}

/**
 * Clear all pools (call on shutdown or for testing).
 */
export function clearAllPools(): void {
  poolCacheVersion++;
  pools.clear();
  pendingLoads.clear();
  keyHealth.clear();
}

/**
 * Get pool info for display (UI shows pool size + next key indicator).
 */
export async function getPoolInfo(
  providerId: number,
  upstreamId: number | null = null,
): Promise<{ size: number; totalWeight: number; keyIds: number[]; penalizedKeyIds: number[] }> {
  const pool = await getPool(providerId, upstreamId);
  const now = Date.now();
  return {
    size: pool.entries.length,
    totalWeight: pool.totalWeight,
    keyIds: pool.entries.map((e) => e.key.id),
    penalizedKeyIds: pool.entries
      .filter((e) => (keyHealth.get(e.key.id)?.penaltyUntil ?? 0) > now)
      .map((e) => e.key.id),
  };
}

export function markKeySuccess(keyId: number): void {
  const state = getKeyHealthState(keyId);
  state.totalSuccesses++;
  state.consecutiveFailures = 0;
  state.penaltyUntil = 0;
}

export function markKeyFailure(keyId: number): void {
  const state = getKeyHealthState(keyId);
  state.totalFailures++;
  state.consecutiveFailures++;
  state.lastFailureAt = Date.now();
  const penaltyMs = Math.min(
    BASE_PENALTY_MS * 2 ** (state.consecutiveFailures - 1),
    MAX_PENALTY_MS,
  );
  state.penaltyUntil = Date.now() + penaltyMs;
}

export function getKeyHealthSnapshot(keyId: number): KeyHealth | null {
  const state = keyHealth.get(keyId);
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
