import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { closeRequestLogStore } from "@/server/ai/log-store";
import { closeCacheStores } from "@/server/cache";
import { closeDb } from "@/server/db";
import { closeEventBus } from "@/server/events";
import { closeSupplierHealthCheckJob } from "@/server/jobs/check-supplier-health";
import { closeLimitedFreeModelExpiryJob } from "@/server/jobs/expire-limited-free-models";
import { closeTopupExpiryJob } from "@/server/jobs/expire-topup-orders";
import { closeLiteLLMPricingJob } from "@/server/jobs/refresh-litellm-pricing";
import { closeDepositScanQueue } from "@/server/jobs/scan-topup-deposit";
import { bootstrapWorker } from "@/server/lib/bootstrap";
import { log, logger } from "@/server/lib/logger";
import { closeRedis } from "@/server/lib/redis";
import { closeWriteQueue, flushWriteQueue } from "@/server/lib/write-queue";
import { stopWebhookRetryJob } from "@/server/messaging/jobs/retry-webhook-deliveries";

import { env } from "./env";

if (env.ROLE && env.ROLE !== "worker") {
  throw new Error(`ROLE=${env.ROLE} must use the API entry point (pnpm start)`);
}

let ready = false;
const health = new Hono();

health.get("/health", (c) => {
  const status = ready ? "ok" : "starting";
  return c.json(
    {
      status,
      role: "worker",
      uptime: Math.floor(process.uptime()),
    },
    ready ? 200 : 503,
  );
});

const healthPort = env.WORKER_HEALTH_PORT;
const healthServer = serve({ fetch: health.fetch, port: healthPort, hostname: "0.0.0.0" }, () => {
  log.bootstrap.info({ port: healthPort }, "Worker health server listening");
});

async function main() {
  await bootstrapWorker();
  ready = true;
  log.bootstrap.info("Worker process ready");
}

main().catch((err) => {
  logger.fatal({ err }, "Worker bootstrap failed");
  shutdown("bootstrap-error").catch((shutdownErr) => {
    logger.fatal({ err: shutdownErr }, "Worker shutdown failed after bootstrap error");
    process.exit(1);
  });
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  log.shutdown.info({ signal }, "Worker shutting down");

  await closeTopupExpiryJob();
  await closeLiteLLMPricingJob();
  stopWebhookRetryJob();

  await closeDepositScanQueue();
  await closeSupplierHealthCheckJob();
  await closeLimitedFreeModelExpiryJob();

  const flushed = await flushWriteQueue(1000);
  log.shutdown.info({ flushed }, "Flushed pending writes");
  await closeWriteQueue();

  await new Promise<void>((resolve) => {
    healthServer.close(() => {
      log.shutdown.info("Worker health server closed");
      resolve();
    });
    setTimeout(resolve, 2_000);
  });

  await Promise.allSettled([closeEventBus(), closeCacheStores()]);
  await closeRequestLogStore();
  await closeRedis();
  await closeDb();

  process.exit(signal === "bootstrap-error" ? 1 : 0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((err) => {
    logger.fatal({ err }, "Worker SIGTERM shutdown failed");
    process.exit(1);
  });
});
process.on("SIGINT", () => {
  shutdown("SIGINT").catch((err) => {
    logger.fatal({ err }, "Worker SIGINT shutdown failed");
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection").catch((err) => {
    logger.fatal({ err }, "Worker unhandledRejection shutdown failed");
    process.exit(1);
  });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
