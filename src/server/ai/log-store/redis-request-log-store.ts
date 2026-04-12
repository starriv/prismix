/**
 * RedisRequestLogStore — stores AI request/response bodies in Redis with TTL.
 *
 * Key format: `ai-req:{requestId}`
 * Value: JSON-serialized RequestLogEntry
 * TTL: configurable via AI_REQUEST_LOG_TTL_DAYS (default 7 days)
 *
 * Body truncation: request/response bodies are capped at MAX_BODY_SIZE (100 KB)
 * to prevent Redis memory exhaustion from large conversation histories.
 */
import type Redis from "ioredis";
import { truncate } from "lodash-es";

import { log } from "@/server/lib/logger";

import type { RequestLogEntry, RequestLogStore } from "./request-log-store";

const KEY_PREFIX = "ai-req:";
const MAX_BODY_SIZE = 102_400; // 100 KB per body field
const DEFAULT_TTL_DAYS = 7;

export class RedisRequestLogStore implements RequestLogStore {
  private readonly redis: Redis;
  private readonly ttlMs: number;

  constructor(redis: Redis, ttlDays = DEFAULT_TTL_DAYS) {
    this.redis = redis;
    this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  }

  async save(entry: RequestLogEntry): Promise<void> {
    try {
      const key = `${KEY_PREFIX}${entry.requestId}`;
      const stored: RequestLogEntry = {
        ...entry,
        requestBody: truncate(entry.requestBody, {
          length: MAX_BODY_SIZE,
          omission: "...[truncated]",
        }),
        responseBody: truncate(entry.responseBody, {
          length: MAX_BODY_SIZE,
          omission: "...[truncated]",
        }),
      };
      await this.redis.set(key, JSON.stringify(stored), "PX", this.ttlMs);
    } catch (err) {
      log.gateway.error({ err, requestId: entry.requestId }, "Failed to save AI request log");
    }
  }

  async get(requestId: string): Promise<RequestLogEntry | null> {
    try {
      const key = `${KEY_PREFIX}${requestId}`;
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as RequestLogEntry;
    } catch (err) {
      log.gateway.error({ err, requestId }, "Failed to read AI request log");
      return null;
    }
  }

  async close(): Promise<void> {
    // Redis connection is shared — do not close it here
  }
}
