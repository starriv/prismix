/**
 * Structured logger — single source of truth for all server logging.
 *
 * Uses pino for structured JSON logging:
 * - Development: pretty-printed with colors via pino-pretty
 * - Production: newline-delimited JSON (NDJSON) for log aggregators
 *
 * Usage:
 *   import { log } from "@/server/lib/logger";
 *   log.gateway.info({ resourceId: 123 }, "Request processed");
 *   log.redis.error({ err }, "Connection failed");
 */
import pino from "pino";

import { requestIdStore } from "@/server/middleware/request-id";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  mixin() {
    const requestId = requestIdStore.getStore();
    return requestId ? { requestId } : {};
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']",
      "req.headers['cf-access-client-secret']",
      "req.headers['CF-Access-Client-Secret']",
      "*.headers['cf-access-client-secret']",
      "*.headers['CF-Access-Client-Secret']",
      "*.password",
      "*.passwordHash",
      "*.password_hash",
      "*.secret",
      "*.clientSecret",
      "*.client_secret",
      "*.privateKey",
      "*.private_key",
      "*.token",
      "*.accessToken",
      "*.access_token",
      "*.refreshToken",
      "*.refresh_token",
      "*.apiKey",
      "*.api_key",
      "*.encryptionKey",
      "*.jwtSecret",
    ],
    censor: "[REDACTED]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

// ── Pre-built child loggers ─────────────────────────────────────────
// Avoids repeated logger.child() allocations on the hot path.
// The `module` field replaces the old `[redis]`, `[gateway]` bracket convention.

function child(module: string) {
  return logger.child({ module });
}

export const log = {
  bootstrap: child("bootstrap"),
  shutdown: child("shutdown"),
  gateway: child("gateway"),
  redis: child("redis"),
  pg: child("pg"),
  auth: child("auth"),
  admin: child("admin"),
  sse: child("sse"),
  msw: child("msw"),
  env: child("env"),
  oauth2: child("oauth2"),
  queue: child("queue"),
  blockchain: child("blockchain"),
  http: child("http"),
  notification: child("notification"),
  event: child("event"),
  webhook: child("webhook"),
  pricing: child("pricing"),
  supplier: child("supplier"),
};
