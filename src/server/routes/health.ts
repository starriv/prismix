/**
 * Health check and metrics endpoints.
 * /health is public (infrastructure probes); /metrics requires admin auth.
 */
import { Hono } from "hono";
import { values } from "lodash-es";

import { CHAIN_CONFIG } from "@/blockchain/config";
import { getRateLimiterStats, getRateLimiterWindowCount } from "@/server/middleware/rate-limiter";

import { getJwtStats } from "../lib/jwt";
import { metricsRegistry } from "../lib/metrics";
import { getListenerCount } from "../lib/sse";
import { getWriteQueueStats } from "../lib/write-queue";
import { adminAuthMiddleware } from "../middleware/auth";
import { userRepo } from "../repos";

const health = new Hono();

// ── GET /health — liveness probe (no external deps) ─────────────────
// Returns 200 as long as the process is alive and listening.
// Used by Railway / Docker HEALTHCHECK to detect crashed containers.

health.get("/health", (c) => {
  return c.json({ status: "ok", uptime: Math.floor(process.uptime()) }, 200);
});

// ── GET /health/ready — readiness probe (checks DB) ─────────────────
// Returns 200 only when the app can serve real traffic (DB reachable).
// Use for load-balancer routing decisions, not container restarts.

health.get("/health/ready", async (c) => {
  let dbOk = false;
  try {
    await userRepo.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const checks = {
    db: dbOk ? "ok" : "fail",
    uptime: Math.floor(process.uptime()),
  };

  if (!dbOk) {
    return c.json({ status: "unhealthy", checks }, 503);
  }
  return c.json({ status: "ok", checks }, 200);
});

// ── GET /prometheus — Prometheus exposition format (public for scraping) ──

health.get("/prometheus", async (c) => {
  const metrics = await metricsRegistry.metrics();
  return c.text(metrics, 200, {
    "Content-Type": metricsRegistry.contentType,
  });
});

// ── GET /metrics — full system metrics (admin-only) ──────────────────

health.get("/metrics", adminAuthMiddleware, async (c) => {
  const [userCount] = await Promise.all([userRepo.count()]);

  const sessions = await getJwtStats();
  const writeQueue = getWriteQueueStats();
  const mem = process.memoryUsage();

  return c.json({
    db: {
      users: userCount,
    },
    sessions,
    sse: { listenerCount: getListenerCount() },
    writeQueue,
    rateLimiter: {
      windowCount: getRateLimiterWindowCount(),
      rules: getRateLimiterStats(),
    },
    config: {
      networkCount: values(CHAIN_CONFIG).length,
    },
    system: {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      nodeVersion: process.version,
    },
  });
});

export default health;
