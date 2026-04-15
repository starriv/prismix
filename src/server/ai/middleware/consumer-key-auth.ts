/**
 * Consumer Key auth middleware — authenticates ska_ relay consumer keys.
 *
 * Balance is managed by the linked pay-agent:
 * 1. Check "Bearer ska_" or "x-api-key: ska_" prefix
 * 2. SHA-256 hash → lookup in relay_consumer_keys
 * 3. Load linked pay-agent, verify agent active + balance > 0
 * 4. Set ConsumerSession on Hono context
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { hashApiKey } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { getRequestId } from "@/server/middleware/request-id";
import { payAgentRepo, relayConsumerKeyRepo, settingsRepo } from "@/server/repos";
import { lte } from "@/shared/number";

import { enqueueAiAccessLog } from "../lib/access-log";

// ── Global default markup cache (60s TTL) ───────────────────────────

export const globalMarkupCache = { value: 0, expiresAt: 0 };
const MARKUP_CACHE_TTL = 60_000;

export async function getGlobalDefaultMarkup(): Promise<number> {
  if (globalMarkupCache.expiresAt > Date.now()) return globalMarkupCache.value;
  const raw = await settingsRepo.getGlobal("ai_default_markup");
  const value = raw !== undefined ? Number(raw) : 0;
  globalMarkupCache.value = value;
  globalMarkupCache.expiresAt = Date.now() + MARKUP_CACHE_TTL;
  return value;
}

export interface ConsumerSession {
  consumerId: number;
  userId: number | null;
  agentId: number;
  agentBalance: string;
  markupPercent: number;
  allowedModels: string[];
  rateLimitRpm: number | null;
  perPayLimit: string | null;
  dailyLimit: string | null;
  monthlyLimit: string | null;
}

type ConsumerEnv = {
  Variables: {
    consumer: ConsumerSession;
  };
};

export const consumerKeyAuthMiddleware = createMiddleware<ConsumerEnv>(async (c, next) => {
  const requestId = getRequestId(c);
  const respondWithAuthError = (
    statusCode: number,
    error: string,
    extras?: Partial<{ consumerKeyId: number | null; userId: number | null }>,
  ) => {
    enqueueAiAccessLog({
      requestId,
      statusCode,
      error,
      consumerKeyId: extras?.consumerKeyId ?? null,
      userId: extras?.userId ?? null,
    });
    return c.json({ error }, statusCode as 401);
  };

  try {
    // Support both OpenAI-style (Authorization: Bearer ska_) and Anthropic-style (x-api-key: ska_)
    const authHeader = c.req.header("Authorization");
    const apiKeyHeader = c.req.header("x-api-key");

    let rawKey: string | undefined;
    if (authHeader?.startsWith("Bearer ska_")) {
      rawKey = authHeader.slice(7);
    } else if (apiKeyHeader?.startsWith("ska_")) {
      rawKey = apiKeyHeader;
    }

    if (!rawKey) {
      return respondWithAuthError(401, "Unauthorized — requires a consumer API key (ska_)");
    }
    const hash = hashApiKey(rawKey);

    const consumer = await relayConsumerKeyRepo.findByApiKeyHash(hash);
    if (!consumer) {
      const deletedKey = await relayConsumerKeyRepo.findBlacklistedByApiKeyHash(hash);
      if (deletedKey) {
        log.gateway.warn(
          { consumerKeyId: deletedKey.relayConsumerKeyId, userId: deletedKey.userId },
          "Deleted consumer key used after blacklist",
        );
        return respondWithAuthError(403, "Consumer key has been deleted", {
          consumerKeyId: deletedKey.relayConsumerKeyId ?? null,
          userId: deletedKey.userId ?? null,
        });
      }
      return respondWithAuthError(401, "Invalid consumer API key");
    }

    // Consumer key status check
    if (consumer.status !== "active") {
      log.gateway.warn({ consumerId: consumer.id }, "Consumer key used but is suspended");
      return respondWithAuthError(403, "Consumer key is suspended", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }

    // Owning user status check (null userStatus = orphan key, allowed through)
    if (consumer.userStatus === 2) {
      log.gateway.warn(
        { consumerId: consumer.id, userId: consumer.userId },
        "Consumer key used but owning user is disabled",
      );
      return respondWithAuthError(403, "Account is disabled", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }

    // Expiry check
    if (consumer.expiresAt && new Date(consumer.expiresAt) < new Date()) {
      return respondWithAuthError(403, "Consumer key has expired", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }

    // Load linked pay-agent for balance
    const agent = await payAgentRepo.findById(consumer.agentId);
    if (!agent) {
      return respondWithAuthError(403, "Linked pay-agent not found", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }
    if (agent.status !== "active") {
      return respondWithAuthError(403, "Linked pay-agent is suspended", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }
    if (lte(agent.balance, "0")) {
      return respondWithAuthError(402, "Agent balance exhausted. Please top up the pay-agent.", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }

    // Parse allowed models — fail-closed: reject if JSON is corrupted
    let allowedModels: string[] = [];
    try {
      const parsed = JSON.parse(consumer.allowedModels) as unknown;
      if (Array.isArray(parsed)) {
        allowedModels = parsed as string[];
      } else {
        log.gateway.warn(
          { consumerId: consumer.id },
          "allowedModels is not an array — denying access",
        );
        return respondWithAuthError(500, "Consumer key configuration error", {
          consumerKeyId: consumer.id,
          userId: consumer.userId,
        });
      }
    } catch {
      log.gateway.warn(
        { consumerId: consumer.id },
        "allowedModels JSON parse failed — denying access",
      );
      return respondWithAuthError(500, "Consumer key configuration error", {
        consumerKeyId: consumer.id,
        userId: consumer.userId,
      });
    }

    c.set("consumer", {
      consumerId: consumer.id,
      userId: consumer.userId,
      agentId: consumer.agentId,
      agentBalance: agent.balance,
      markupPercent:
        consumer.markupPercent ?? agent.defaultMarkupPercent ?? (await getGlobalDefaultMarkup()),
      allowedModels,
      rateLimitRpm: consumer.rateLimitRpm,
      perPayLimit: agent.perPayLimit,
      dailyLimit: agent.dailyLimit,
      monthlyLimit: agent.monthlyLimit,
    });

    await next();
  } catch (err) {
    log.gateway.error({ err, requestId }, "Consumer key auth middleware failed unexpectedly");
    enqueueAiAccessLog({
      requestId,
      statusCode: 500,
      error: err instanceof Error ? err.message : "Internal auth error",
    });
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/** Type-safe accessor for consumer session. */
export function getConsumerSession(c: Context): ConsumerSession {
  return c.get("consumer" as never) as ConsumerSession;
}
