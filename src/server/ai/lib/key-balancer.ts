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
 * The pool is lazily initialized from DB on first access and invalidated on key CRUD.
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
}

export type BalancerStrategy = "round-robin" | "random";

// ── State ────────────────────────────────────────────────────────────

/** Pool cache: "providerId" → Pool */
const pools = new Map<string, Pool>();

function poolKey(providerId: number): string {
  return `${providerId}`;
}

// ── Pool loading ─────────────────────────────────────────────────────

async function loadPool(providerId: number): Promise<Pool> {
  // Load provider strategy
  const config = await aiProviderRepo.findBalancerConfig(providerId);
  const strategy = (
    config?.loadBalanceStrategy === "random" ? "random" : "round-robin"
  ) as BalancerStrategy;

  const rows = await aiKeyRepo.findEnabledByProvider(providerId);

  const entries: PoolEntry[] = rows.map((r) => ({
    key: r,
    weight: r.weight,
    currentWeight: 0,
  }));

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return { entries, totalWeight, strategy };
}

async function getPool(providerId: number): Promise<Pool> {
  const pk = poolKey(providerId);
  let pool = pools.get(pk);
  if (!pool) {
    pool = await loadPool(providerId);
    pools.set(pk, pool);
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

  for (const entry of pool.entries) {
    entry.currentWeight += entry.weight;
    if (!best || entry.currentWeight > best.currentWeight) {
      best = entry;
    }
  }

  if (!best) return undefined;
  best.currentWeight -= pool.totalWeight;
  return best.key;
}

/**
 * Weighted random — probabilistic selection proportional to weights.
 */
function selectRandom(pool: Pool): AiKey | undefined {
  if (pool.entries.length === 0) return undefined;
  if (pool.entries.length === 1) return pool.entries[0].key;

  const rand = Math.random() * pool.totalWeight;
  let cumulative = 0;
  for (const entry of pool.entries) {
    cumulative += entry.weight;
    if (rand < cumulative) return entry.key;
  }
  return pool.entries[pool.entries.length - 1].key;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Pick the next key from a provider pool.
 * Strategy is read from the provider's `loadBalanceStrategy` column.
 * Returns undefined if no enabled keys with weight > 0 exist.
 */
export async function pickKey(providerId: number): Promise<AiKey | undefined> {
  const pool = await getPool(providerId);

  if (pool.entries.length === 0) return undefined;

  const key = pool.strategy === "random" ? selectRandom(pool) : selectRoundRobin(pool);

  if (key) {
    log.pricing.debug(
      { keyId: key.id, keyName: key.name, strategy: pool.strategy, poolSize: pool.entries.length },
      "Key selected from pool",
    );
  }

  return key;
}

/**
 * Invalidate a specific provider pool (call after key CRUD).
 * Next `pickKey` call will reload from DB.
 */
export function invalidateKeyPool(providerId: number): void {
  pools.delete(poolKey(providerId));
}

/**
 * Clear all pools (call on shutdown or for testing).
 */
export function clearAllPools(): void {
  pools.clear();
}

/**
 * Get pool info for display (UI shows pool size + next key indicator).
 */
export async function getPoolInfo(
  providerId: number,
): Promise<{ size: number; totalWeight: number; keyIds: number[] }> {
  const pool = await getPool(providerId);
  return {
    size: pool.entries.length,
    totalWeight: pool.totalWeight,
    keyIds: pool.entries.map((e) => e.key.id),
  };
}
