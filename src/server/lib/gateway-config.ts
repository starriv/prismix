/**
 * Gateway resilience configuration — DB-backed with in-memory cache.
 *
 * Stores all gateway config as JSON in the `globalSettings` table
 * with `gw_` key prefix. Provides typed defaults and a cached getter.
 */
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { log } from "@/server/lib/logger";
import { settingsRepo } from "@/server/repos";

// ── Type definitions ─────────────────────────────────────────────────

export interface RateLimitRule {
  name: string;
  pathPattern: string;
  maxRequests: number;
  windowMs: number;
  dimension: "ip" | "token" | "global";
  enabled: boolean;
}

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
  enabled: boolean;
}

export interface TimeoutConfig {
  upstreamFetchMs: number;
  streamIdleMs: number;
  streamMaxDurationMs: number;
  upstreamFetchOverrides: UpstreamFetchTimeoutOverride[];
}

export interface UpstreamFetchTimeoutOverride {
  endpointId?: string;
  modelId?: string;
  upstreamFetchMs: number;
}

export interface QueueConfig {
  maxWriteQueueDepth: number;
  maxLogQueueDepth: number;
}

export interface GatewayConfig {
  rateLimits: RateLimitRule[];
  circuitBreakers: CircuitBreakerConfig[];
  timeouts: TimeoutConfig;
  queue: QueueConfig;
}

// ── DB keys ──────────────────────────────────────────────────────────

const GW_RATE_LIMIT = "gw_rate_limit";
const GW_CIRCUIT_BREAKER = "gw_circuit_breaker";
const GW_TIMEOUT = "gw_timeout";
const GW_QUEUE = "gw_queue";

export const GW_SETTINGS_KEYS = [GW_RATE_LIMIT, GW_CIRCUIT_BREAKER, GW_TIMEOUT, GW_QUEUE] as const;

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_RATE_LIMITS: RateLimitRule[] = [
  {
    name: "Global per-IP",
    pathPattern: "*",
    maxRequests: 10_000,
    windowMs: 60_000,
    dimension: "ip",
    enabled: true,
  },
  {
    name: "AI Gateway per-token",
    pathPattern: "/api/gateway/ai/*",
    maxRequests: 100_000,
    windowMs: 60_000,
    dimension: "token",
    enabled: true,
  },
  {
    name: "Auth per-IP",
    pathPattern: "/api/auth/*",
    maxRequests: 30,
    windowMs: 60_000,
    dimension: "ip",
    enabled: true,
  },
  {
    name: "Admin Auth per-IP",
    pathPattern: "/api/admin-auth/*",
    maxRequests: 30,
    windowMs: 60_000,
    dimension: "ip",
    enabled: true,
  },
  {
    name: "Admin API per-token",
    pathPattern: "/api/admin/*",
    maxRequests: 10_000,
    windowMs: 60_000,
    dimension: "token",
    enabled: true,
  },
];

const DEFAULT_CIRCUIT_BREAKERS: CircuitBreakerConfig[] = [
  {
    name: "upstream",
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    halfOpenRequests: 2,
    enabled: true,
  },
];

const DEFAULT_TIMEOUTS: TimeoutConfig = {
  upstreamFetchMs: 120_000, // 120s — extended thinking models need 60-120s for first token
  streamIdleMs: 5 * 60 * 1000,
  streamMaxDurationMs: 30 * 60 * 1000,
  upstreamFetchOverrides: [{ endpointId: "deepseek", upstreamFetchMs: 600_000 }],
};

const DEFAULT_QUEUE: QueueConfig = {
  maxWriteQueueDepth: 10_000,
  maxLogQueueDepth: 5_000,
};

// ── JSON helpers ─────────────────────────────────────────────────────

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Load / Save ──────────────────────────────────────────────────────

export async function loadGatewayConfig(): Promise<GatewayConfig> {
  const timeouts = parseJson<Partial<TimeoutConfig>>(await settingsRepo.getGlobal(GW_TIMEOUT), {});
  return {
    rateLimits: parseJson(await settingsRepo.getGlobal(GW_RATE_LIMIT), DEFAULT_RATE_LIMITS),
    circuitBreakers: parseJson(
      await settingsRepo.getGlobal(GW_CIRCUIT_BREAKER),
      DEFAULT_CIRCUIT_BREAKERS,
    ),
    timeouts: resolveTimeoutConfig(timeouts),
    queue: parseJson(await settingsRepo.getGlobal(GW_QUEUE), DEFAULT_QUEUE),
  };
}

export type GatewayConfigSection = keyof GatewayConfig;

export async function saveGatewayConfigSection<K extends GatewayConfigSection>(
  section: K,
  value: GatewayConfig[K],
): Promise<void> {
  const keyMap: Record<GatewayConfigSection, string> = {
    rateLimits: GW_RATE_LIMIT,
    circuitBreakers: GW_CIRCUIT_BREAKER,
    timeouts: GW_TIMEOUT,
    queue: GW_QUEUE,
  };
  await settingsRepo.setGlobal(keyMap[section], JSON.stringify(value));
  invalidateGatewayConfig();
  emit(DOMAIN_EVENT_TYPES.CONFIG_GATEWAY_UPDATED, null);
}

// ── In-memory cache ──────────────────────────────────────────────────

let cachedConfig: GatewayConfig | null = null;

/**
 * Get cached gateway config. Must call `initGatewayConfig()` at startup
 * to populate the cache. Subsequent calls return the cached value.
 */
export function getGatewayConfigCached(): GatewayConfig {
  if (!cachedConfig) {
    // Return defaults if not yet initialized (shouldn't happen after bootstrap)
    return {
      rateLimits: DEFAULT_RATE_LIMITS,
      circuitBreakers: DEFAULT_CIRCUIT_BREAKERS,
      timeouts: DEFAULT_TIMEOUTS,
      queue: DEFAULT_QUEUE,
    };
  }
  return cachedConfig;
}

/** Async init — call at startup to populate the config cache from DB */
export async function initGatewayConfig(): Promise<void> {
  cachedConfig = await loadGatewayConfig();
}

export function invalidateGatewayConfig(): void {
  // Async reload — keeps the old cache available until the reload completes
  loadGatewayConfig()
    .then((fresh) => {
      cachedConfig = fresh;
    })
    .catch((err) => {
      // On failure, keep stale config rather than losing it
      log.gateway.warn({ err }, "Gateway config reload failed — keeping stale config");
    });
}

export function resolveTimeoutConfig(config?: Partial<TimeoutConfig> | null): TimeoutConfig {
  const upstreamFetchOverrides = resolveUpstreamFetchOverrides(config?.upstreamFetchOverrides);

  return {
    upstreamFetchMs: config?.upstreamFetchMs ?? DEFAULT_TIMEOUTS.upstreamFetchMs,
    streamIdleMs: config?.streamIdleMs ?? DEFAULT_TIMEOUTS.streamIdleMs,
    streamMaxDurationMs: config?.streamMaxDurationMs ?? DEFAULT_TIMEOUTS.streamMaxDurationMs,
    upstreamFetchOverrides,
  };
}

function resolveUpstreamFetchOverrides(
  overrides: Partial<UpstreamFetchTimeoutOverride>[] | undefined,
): UpstreamFetchTimeoutOverride[] {
  if (!overrides) return DEFAULT_TIMEOUTS.upstreamFetchOverrides;

  const normalized: UpstreamFetchTimeoutOverride[] = [];

  for (const override of overrides) {
    const endpointId = normalizeOverrideKey(override.endpointId);
    const modelId = normalizeOverrideKey(override.modelId);
    const upstreamFetchMs = override.upstreamFetchMs;
    if (
      !(endpointId || modelId) ||
      typeof upstreamFetchMs !== "number" ||
      !Number.isFinite(upstreamFetchMs) ||
      upstreamFetchMs <= 0
    ) {
      continue;
    }

    normalized.push({ endpointId, modelId, upstreamFetchMs });
  }

  if (normalized.length < overrides.length) {
    log.gateway.warn(
      { dropped: overrides.length - normalized.length, total: overrides.length },
      "Dropped invalid gateway upstream fetch timeout overrides",
    );
  }

  return normalized;
}

function normalizeOverrideKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the first-byte timeout for a public gateway model.
 * `modelId` should be the gateway-facing model slug, not a per-upstream mapped slug.
 */
export function resolveUpstreamFetchTimeoutMs(
  config: TimeoutConfig,
  match: { endpointId?: string | null; modelId?: string | null },
): number {
  const endpointId = match.endpointId ?? undefined;
  const modelId = match.modelId ?? undefined;
  const matches = config.upstreamFetchOverrides
    .map((item) => {
      const endpointMatches = !item.endpointId || item.endpointId === endpointId;
      const modelMatches = !item.modelId || item.modelId === modelId;
      if (!endpointMatches || !modelMatches) return null;
      return {
        item,
        specificity: (item.endpointId ? 1 : 0) + (item.modelId ? 1 : 0),
      };
    })
    .filter((item): item is { item: UpstreamFetchTimeoutOverride; specificity: number } =>
      Boolean(item),
    );
  const override = matches.sort((a, b) => b.specificity - a.specificity)[0]?.item;

  return override?.upstreamFetchMs ?? config.upstreamFetchMs;
}
