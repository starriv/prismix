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
import { getRedis } from "../lib/redis";
import { getListenerCount } from "../lib/sse";
import { getWriteQueueStats } from "../lib/write-queue";
import { adminAuthMiddleware } from "../middleware/auth";
import { userRepo } from "../repos";

const health = new Hono();

// ── GET /health — combined liveness + readiness ─────────────────────
// Returns 200 when DB and Redis are reachable, 503 otherwise.
// Used by Railway healthcheckPath / Docker HEALTHCHECK.

health.get("/health", async (c) => {
  let dbOk = false;
  let redisOk = false;

  try {
    await userRepo.count();
    dbOk = true;
  } catch {
    /* db unreachable */
  }

  try {
    const pong = await getRedis().ping();
    redisOk = pong === "PONG";
  } catch {
    /* redis unreachable */
  }

  const checks = {
    db: dbOk ? "ok" : "fail",
    redis: redisOk ? "ok" : "fail",
    uptime: Math.floor(process.uptime()),
  };

  if (!dbOk || !redisOk) {
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
