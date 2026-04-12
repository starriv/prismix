/**
 * Prometheus metrics — standard exposition format at /metrics.
 *
 * Key metrics for a payment gateway:
 * - HTTP request duration (histogram) — latency distribution per route
 * - HTTP request total (counter) — traffic volume and error rates
 * - Active connections (gauge) — SSE + in-flight requests
 * - Queue depth (gauge) — write queue and log queue backpressure
 * - Process metrics — Node.js memory, CPU, event loop lag (built-in)
 */
import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from "prom-client";

// ── Default Node.js metrics (memory, CPU, event loop, GC) ───────────

collectDefaultMetrics({ prefix: "prismix_" });

// ── HTTP request metrics ────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: "prismix_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const httpRequestTotal = new Counter({
  name: "prismix_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});

// ── Gateway-specific metrics ────────────────────────────────────────

export const gatewayPaymentTotal = new Counter({
  name: "prismix_gateway_payments_total",
  help: "Total payment transactions recorded",
  labelNames: ["status"] as const, // settled, failed
});

export const gatewayUpstreamDuration = new Histogram({
  name: "prismix_gateway_upstream_duration_seconds",
  help: "Upstream fetch duration in seconds",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

// ── Queue metrics ───────────────────────────────────────────────────

export const queueDepth = new Gauge({
  name: "prismix_queue_depth",
  help: "Current queue depth",
  labelNames: ["queue"] as const, // write-queue, log-queue, payment-log-queue
});

export const queueDropped = new Counter({
  name: "prismix_queue_dropped_total",
  help: "Total tasks dropped due to queue overflow",
  labelNames: ["queue"] as const,
});

// ── Connection metrics ──────────────────────────────────────────────

export const sseConnections = new Gauge({
  name: "prismix_sse_connections",
  help: "Current active SSE connections",
});

export const rateLimitRejections = new Counter({
  name: "prismix_rate_limit_rejections_total",
  help: "Total rate limit rejections",
  labelNames: ["rule"] as const,
});

export const circuitBreakerState = new Gauge({
  name: "prismix_circuit_breaker_state",
  help: "Circuit breaker state (0=closed, 1=half_open, 2=open)",
  labelNames: ["name"] as const,
});

// ── Registry export ─────────────────────────────────────────────────

export { register as metricsRegistry };

/**
 * Normalize a URL path to a route label for Prometheus metrics.
 * Prevents high-cardinality labels by collapsing path parameters.
 *
 * /api/admin/resources/123 → /api/admin/resources/:id
 */
export function normalizeRoute(path: string): string {
  // Agent paths
  if (path.startsWith("/api/agent/")) {
    return path.replace(/\/v1\/\w+\/.*/, "/v1/*");
  }
  // Numeric IDs in path segments
  return path.replace(/\/\d+/g, "/:id");
}
