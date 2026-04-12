/**
 * HTTP request logger middleware — pino-based replacement for hono/logger.
 *
 * Outputs structured JSON per request: { method, path, status, latencyMs }.
 * In dev, pino-pretty renders it as a colored one-liner.
 * In production, log aggregators (ELK, Datadog, CloudWatch) index the fields directly.
 */
import type { MiddlewareHandler } from "hono";

import { log } from "@/server/lib/logger";
import { httpRequestDuration, httpRequestTotal, normalizeRoute } from "@/server/lib/metrics";

import { getRequestId } from "./request-id";

export function httpLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const latencyMs = Date.now() - start;

    const method = c.req.method;
    const route = normalizeRoute(c.req.path);
    const statusCode = String(c.res.status);

    // Prometheus metrics
    httpRequestDuration.observe({ method, route, status_code: statusCode }, latencyMs / 1000);
    httpRequestTotal.inc({ method, route, status_code: statusCode });

    log.http.info(
      {
        requestId: getRequestId(c),
        method,
        path: c.req.path,
        status: c.res.status,
        latencyMs,
      },
      `${method} ${c.req.path} ${c.res.status} ${latencyMs}ms`,
    );
  };
}
