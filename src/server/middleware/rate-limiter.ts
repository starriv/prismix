/**
 * Global sliding-window rate limiter middleware.
 *
 * Config-driven from gateway-config.ts. Supports per-IP, per-token,
 * and global dimensions with path pattern matching.
 *
 * Uses the RateLimitStore strategy pattern:
 * - RedisRateLimitStore (distributed, shared across instances via Redis)
 */
import type { Context, MiddlewareHandler } from "hono";

import { getClientIp } from "@/server/lib/client-ip";
import type { RateLimitRule } from "@/server/lib/gateway-config";
import { getGatewayConfigCached } from "@/server/lib/gateway-config";
import { createRateLimitStore, type RateLimitStore } from "@/server/rate-limit";

// ── Store (selected at module load based on REDIS_URL) ──────────────

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (!store) store = createRateLimitStore();
  return store;
}

// ── Per-rule stats (per-instance only, not aggregated across instances) ──

interface RuleStats {
  hits: number;
  rejected: number;
}

const ruleStats = new Map<string, RuleStats>();

// ── Pattern matching ────────────────────────────────────────────────

function matchPath(pattern: string, path: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + "/");
  }
  return path === pattern;
}

// ── Key builder ─────────────────────────────────────────────────────

function buildKey(rule: RateLimitRule, c: Context): string {
  const dim = rule.dimension;
  let identifier: string;

  if (dim === "ip") {
    identifier = getClientIp(c);
  } else if (dim === "token") {
    identifier = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "anonymous";
  } else {
    identifier = "global";
  }

  return `global:${rule.name}:${identifier}`;
}

// ── Middleware factory ───────────────────────────────────────────────

export function createRateLimiterMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const config = getGatewayConfigCached();
    const path = c.req.path;
    const rlStore = getStore();

    // Find the most specific matching enabled rule
    const matchingRules = config.rateLimits.filter(
      (r) => r.enabled && matchPath(r.pathPattern, path),
    );

    for (const rule of matchingRules) {
      const key = buildKey(rule, c);
      const { count, resetMs } = await rlStore.increment(key, rule.windowMs);

      // Track stats
      const statsKey = rule.name;
      let stats = ruleStats.get(statsKey);
      if (!stats) {
        stats = { hits: 0, rejected: 0 };
        ruleStats.set(statsKey, stats);
      }
      stats.hits++;

      if (count > rule.maxRequests) {
        stats.rejected++;
        c.header("Retry-After", String(Math.ceil(resetMs / 1000)));
        c.header("X-RateLimit-Limit", String(rule.maxRequests));
        c.header("X-RateLimit-Remaining", "0");
        return c.json({ error: "Rate limit exceeded" }, 429);
      }

      c.header("X-RateLimit-Limit", String(rule.maxRequests));
      c.header("X-RateLimit-Remaining", String(Math.max(0, rule.maxRequests - count)));
    }

    await next();
  };
}

// ── Stats ───────────────────────────────────────────────────────────

export interface RateLimitStats {
  name: string;
  hits: number;
  rejected: number;
}

export function getRateLimiterStats(): RateLimitStats[] {
  const config = getGatewayConfigCached();
  return config.rateLimits.map((rule) => {
    const stats = ruleStats.get(rule.name);
    return {
      name: rule.name,
      hits: stats?.hits ?? 0,
      rejected: stats?.rejected ?? 0,
    };
  });
}

export function getRateLimiterWindowCount(): number {
  return getStore().size();
}
