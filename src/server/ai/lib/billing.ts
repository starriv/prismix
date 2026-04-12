/**
 * Consumer billing helpers — cost calculation, balance debit, usage logging, request logging.
 *
 * Extracted from consumer-relay.ts to keep route handlers focused on orchestration.
 * Used by both `/v1/chat/completions` and the generic `/v1/*` passthrough.
 */
import { emit } from "@/server/events";
import { log } from "@/server/lib/logger";
import { enqueueJob } from "@/server/lib/write-queue";
import { payAgentRepo } from "@/server/repos";
import { gt, removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import type { TokenUsage } from "../providers/types";

// ── Types ──────────────────────────────────────────────────────────

export interface ConsumerBillingContext {
  agentId: number;
  userId: number | null;
  consumerId: number;
  markupPercent: number;
  perPayLimit: string | null;
  dailyLimit: string | null;
  monthlyLimit: string | null;
}

export interface BillConsumerParams {
  usage: TokenUsage | null;
  latencyMs: number;
  consumer: ConsumerBillingContext;
  keyId: number;
  providerId: string;
  modelId: string;
  inputPrice: string;
  outputPrice: string;
  requestId: string;
  statusCode: number;
  error?: string;
  /** Serialized request body — for request logging (if logging is enabled). */
  requestBody?: string;
  /** Raw response body — for request logging. */
  responseBody?: string;
}

// ── Cost Calculation ───────────────────────────────────────────────

/** Calculate upstream cost and consumer cost (with markup) for a given usage. */
export function calculateConsumerCost(
  usage: TokenUsage | null,
  inputPrice: string,
  outputPrice: string,
  markupPercent: number,
): { upstreamCost: string; consumerCost: string; costStr: string } {
  const upstreamCost = usage
    ? safePlus(
        safeDividedBy(safeMultipliedBy(usage.inputTokens, inputPrice), 1_000_000),
        safeDividedBy(safeMultipliedBy(usage.outputTokens, outputPrice), 1_000_000),
      )
    : "0";
  const consumerCost = safeMultipliedBy(upstreamCost, 1 + markupPercent / 100);
  const costStr = removeTailingZero(consumerCost, 6);
  return { upstreamCost, consumerCost, costStr };
}

// ── Billing Pipeline ───────────────────────────────────────────────

/**
 * Shared billing logic for consumer AI usage — debit balance, log usage, log request body.
 *
 * Used by all consumer relay paths (chat/completions + passthrough, streaming + non-streaming).
 */
export async function billConsumer(p: BillConsumerParams): Promise<void> {
  const { upstreamCost, costStr } = calculateConsumerCost(
    p.usage,
    p.inputPrice,
    p.outputPrice,
    p.consumer.markupPercent,
  );

  // Per-pay limit check (streaming: response already sent, suspend if exceeded)
  if (p.consumer.perPayLimit && gt(costStr, p.consumer.perPayLimit)) {
    log.gateway.warn(
      { agentId: p.consumer.agentId, cost: costStr, limit: p.consumer.perPayLimit },
      "AI request exceeded per-pay limit — suspending agent",
    );
    await payAgentRepo.update(p.consumer.agentId, { status: "suspended" });
    emit("agent.suspended", null, { agentId: p.consumer.agentId });
  }

  // Debit balance
  if (gt(costStr, "0")) {
    const debited = await payAgentRepo.debitBalance(p.consumer.agentId, costStr);
    if (debited) {
      enqueueJob("agent-ai-txn", {
        agentId: p.consumer.agentId,
        userId: p.consumer.userId,
        type: "ai_usage",
        amount: costStr,
        balanceBefore: safePlus(debited.balance, costStr),
        balanceAfter: debited.balance,
        referenceType: "ai_usage",
        description: `AI: ${p.modelId} (${p.usage?.totalTokens ?? 0} tokens)`,
        source: "platform",
        consumerKeyId: p.consumer.consumerId,
        modelId: p.modelId,
        tokens: p.usage?.totalTokens ?? 0,
        requestId: p.requestId,
        upstreamCost: removeTailingZero(upstreamCost, 6),
        markupPercent: p.consumer.markupPercent,
        aiKeyId: p.keyId,
      } as Record<string, unknown>);
    } else {
      log.gateway.warn(
        { agentId: p.consumer.agentId, cost: costStr },
        "AI debit failed — suspending agent",
      );
      await payAgentRepo.update(p.consumer.agentId, { status: "suspended" });
      emit("agent.suspended", null, { agentId: p.consumer.agentId });
    }
  }

  // Log usage
  enqueueJob("ai-usage-log", {
    keyId: p.keyId,
    consumerKeyId: p.consumer.consumerId,
    userId: p.consumer.userId,
    providerId: p.providerId,
    modelId: p.modelId,
    inputTokens: p.usage?.inputTokens ?? 0,
    outputTokens: p.usage?.outputTokens ?? 0,
    totalTokens: p.usage?.totalTokens ?? 0,
    cacheCreationInputTokens: p.usage?.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: p.usage?.cacheReadInputTokens ?? 0,
    estimatedCost: costStr,
    upstreamCost: removeTailingZero(upstreamCost, 6),
    markupPercent: p.consumer.markupPercent,
    latencyMs: p.latencyMs,
    statusCode: p.statusCode,
    requestId: p.requestId,
    error: p.error ?? null,
  } as Record<string, unknown>);
  enqueueJob("consumer-key-touch", { consumerId: p.consumer.consumerId });
  enqueueJob("ai-key-touch", { keyId: p.keyId, keyType: "admin" });

  // Request/response body logging (opt-in)
  if (p.requestBody) {
    enqueueJob("ai-request-log", {
      requestId: p.requestId,
      consumerKeyId: p.consumer.consumerId,
      modelId: p.modelId,
      requestBody: p.requestBody,
      responseBody: p.responseBody ?? "",
      createdAt: new Date().toISOString(),
    } as Record<string, unknown>);
  }
}
