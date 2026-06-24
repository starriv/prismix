// Must be first — loads .env.local before any other import reads process.env
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { closeRequestLogStore } from "@/server/ai/log-store";
import { closeCacheStores } from "@/server/cache";
import { closeDb } from "@/server/db";
import { closeEventBus } from "@/server/events";
import { createRateLimiterMiddleware } from "@/server/middleware/rate-limiter";

// Register auth strategies before API routes can receive traffic.
import "./auth/index";
import { env } from "./env";
import { closeSupplierHealthCheckJob } from "./jobs/check-supplier-health";
import { closeLimitedFreeModelExpiryJob } from "./jobs/expire-limited-free-models";
import { closeTopupExpiryJob } from "./jobs/expire-topup-orders";
import { closeLiteLLMPricingJob } from "./jobs/refresh-litellm-pricing";
import { closeDepositScanQueue } from "./jobs/scan-topup-deposit";
import { bootstrapAll, bootstrapApi } from "./lib/bootstrap";
import { AppError } from "./lib/errors";
import { log, logger } from "./lib/logger";
import { closeRedis } from "./lib/redis";
import { closeWriteQueue, flushWriteQueue } from "./lib/write-queue";
import { stopWebhookRetryJob } from "./messaging/jobs/retry-webhook-deliveries";
import { httpLogger } from "./middleware/http-logger";
import { getRequestId } from "./middleware/request-id";
import { requestId } from "./middleware/request-id";
import { registerRoutes } from "./routes/index";

const ROLE = env.ROLE ?? "all";
if (ROLE === "worker") {
  throw new Error("ROLE=worker must use the worker entry point (pnpm start:worker)");
}

const app = new Hono();

app.use("*", requestId());
app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://static.cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "wss:", "https:"],
      frameAncestors: ["'none'"],
    },
  }),
);
app.use("*", httpLogger());

// ── CORS ─────────────────────────────────────────────────────────────
// AI Gateway: open to all origins (consumer key is the access control).
app.use("/api/gateway/*", cors({ origin: "*" }));
app.use("/api/health/*", cors());
app.use("/api/health", cors());
app.use("/api/prometheus", cors());

// Dashboard / admin API: restrict to same-origin in production.
// In dev, allow Vite dev server origin.
const DASHBOARD_ORIGIN =
  process.env.CORS_ORIGIN ||
  (process.env.NODE_ENV === "production"
    ? undefined // same-origin only (no CORS header = browser blocks cross-origin)
    : env.VITE_DEV_PORT
      ? `http://localhost:${env.VITE_DEV_PORT}`
      : undefined);
app.use(
  "/api/*",
  cors({
    origin: DASHBOARD_ORIGIN ? [DASHBOARD_ORIGIN] : [],
    credentials: true,
  }),
);

// ── Request body size limit ──────────────────────────────────────────
// AI Gateway needs a higher limit: Claude Code sends full conversation history
// (files, tool results, extended thinking) in a single request — easily 5-20 MB.
app.use("/api/*", async (c, next) => {
  const maxSize = c.req.path.startsWith("/api/gateway/ai/")
    ? 20 * 1024 * 1024 // 20 MB — AI gateway (long conversations)
    : 1 * 1024 * 1024; //  1 MB — all other API routes
  return bodyLimit({ maxSize })(c, next);
});

// ── Global rate limiter ──────────────────────────────────────────────
app.use("*", createRateLimiterMiddleware());

// ── Global error handler ─────────────────────────────────────────────
app.onError((err, c) => {
  const isDev = process.env.NODE_ENV === "development";

  // AppError subclasses carry their own status + code — return structured response
  if (err instanceof AppError) {
    if (err.status >= 500) {
      log.http.error({ err, requestId: getRequestId(c) }, "Server error");
    }
    return c.json(err.toJSON(), err.status as ContentfulStatusCode);
  }

  // Unknown errors — log fully, return generic 500
  log.http.error({ err, requestId: getRequestId(c) }, "Unhandled request error");
  return c.json({ error: isDev ? err.message : "Internal Server Error" }, 500);
});

registerRoutes(app);

// In production, serve built static files
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.get("*", serveStatic({ root: "./dist/web", path: "index.html" }));
}

const PORT = env.PORT;
if (!PORT) {
  throw new Error("PORT is required for the API process");
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, async (info) => {
  // Node.js defaults: keepAliveTimeout=5s, headersTimeout=60s.
  // With Caddy in front, a 5s keepAlive gap between requests causes ECONNRESET
  // when Caddy reuses the connection. Set well above the longest expected gap
  // between requests on a keep-alive connection (Caddy default is 0 = unlimited).
  // headersTimeout must be greater than keepAliveTimeout per Node.js docs.
  const httpServer = server as import("node:http").Server;
  httpServer.keepAliveTimeout = 310_000; // 5min 10s — survives long inter-request gaps
  httpServer.headersTimeout = 320_000; // slightly above keepAliveTimeout

  printBanner(info.port);
  // Bootstrap AFTER port is bound — health check is reachable while services init
  try {
    if (ROLE === "api") {
      await bootstrapApi();
    } else {
      await bootstrapAll();
    }
    log.bootstrap.info({ role: ROLE }, "All services ready");
  } catch (err) {
    log.bootstrap.fatal(
      { err },
      "Bootstrap failed — health check stays alive but service is degraded",
    );
  }
});

// ── Startup banner ──────────────────────────────────────────────────

function printBanner(p: number) {
  const isProd = process.env.NODE_ENV === "production";
  const base = `http://localhost:${p}`;

  const lines = [
    `  API       → ${base}`,
    `  Health    → ${base}/api/health`,
    `  AI Relay  → ${base}/api/gateway/ai/*`,
    `  Role      → ${ROLE}`,
  ];
  if (!isProd && env.VITE_DEV_PORT) {
    lines.push(`  Web (dev) → http://localhost:${env.VITE_DEV_PORT}`);
  }
  lines.push(
    `  Docs      → ${isProd || !env.VITE_DEV_PORT ? base : `http://localhost:${env.VITE_DEV_PORT}`}/docs`,
  );

  const maxLen = Math.max(...lines.map((l) => l.length));
  const pad = (s: string) => s + " ".repeat(maxLen - s.length);

  const c = "\x1b[36m"; // cyan
  const b = "\x1b[1m"; // bold
  const r = "\x1b[0m"; // reset

  console.log("");
  console.log(`${c}  ┌${"─".repeat(maxLen + 2)}┐${r}`);
  console.log(`${c}  │${r} ${b}✦ Prismix${r}${" ".repeat(maxLen - 8)} ${c}│${r}`);
  console.log(`${c}  ├${"─".repeat(maxLen + 2)}┤${r}`);
  for (const line of lines) {
    console.log(`${c}  │${r} ${pad(line)} ${c}│${r}`);
  }
  console.log(`${c}  └${"─".repeat(maxLen + 2)}┘${r}`);
  console.log("");
}

// ── Graceful shutdown ────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.shutdown.info({ signal }, "Received signal, shutting down gracefully");

  // 1. Stop timers/queues started by this process.
  if (ROLE === "all") {
    await closeTopupExpiryJob();
    await closeSupplierHealthCheckJob();
    await closeLimitedFreeModelExpiryJob();
    await closeLiteLLMPricingJob();
    stopWebhookRetryJob();
  }
  await closeDepositScanQueue();

  // 2. Stop accepting new connections (2s timeout for in-flight drain)
  await new Promise<void>((resolve) => {
    server.close(() => {
      log.shutdown.info("Server closed, in-flight requests drained");
      resolve();
    });
    setTimeout(resolve, 2_000);
  });

  // 3. Flush pending writes (1s budget — best-effort in dev)
  const flushed = await flushWriteQueue(1000);
  log.shutdown.info({ flushed }, "Flushed pending writes");
  await closeWriteQueue();

  // 4. Close event bus (Redis subscriber), cache, Redis, DB — in parallel
  await Promise.allSettled([closeEventBus(), closeCacheStores()]);
  await closeRequestLogStore();
  await closeRedis();
  await closeDb();

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Crash handlers — log and exit cleanly ────────────────────────────

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  // Must exit — the process is in an undefined state
  process.exit(1);
});

export default app;
