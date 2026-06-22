/**
 * Unified 7-value health status for providers and upstreams.
 * Computed server-side in overview endpoints from DB health + runtime signals.
 *
 * - `healthy`:   probe succeeded AND recent error rate < 20%
 * - `degraded`:  probe failed (non-critical) OR recent error rate >= 20%
 * - `down`:      autoDisabled by health job OR healthStatus === "down" in DB
 * - `no-key`:    enabled but zero enabled API keys bound
 * - `idle`:      enabled, has keys, but no requests in last 30min
 * - `unknown`:   never probed yet (fresh entity)
 * - `disabled`:  admin disabled (enabled=false)
 */
export type HealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "down"
  | "idle"
  | "no-key"
  | "disabled";

/**
 * Sort priority for health status display (lower = more severe = shown first).
 * Used to order rows so unhealthy items surface to the top.
 */
export const HEALTH_SEVERITY_RANK: Record<HealthStatus, number> = {
  down: 0,
  degraded: 1,
  "no-key": 2,
  unknown: 3,
  idle: 4,
  healthy: 5,
  disabled: 6,
};
