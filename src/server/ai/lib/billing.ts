/**
 * Consumer billing helpers — cost calculation, balance debit, usage logging, request logging.
 *
 * Extracted from consumer-relay.ts to keep route handlers focused on orchestration.
 * Used by both `/v1/chat/completions` and the generic `/v1/*` passthrough.
 */
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { log } from "@/server/lib/logger";
import { enqueueJob } from "@/server/lib/write-queue";
import { payAgentRepo, payAgentTransactionRepo } from "@/server/repos";
import { gt, removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import type { TokenUsage } from "../protocol-adapters/types";
import {
  type AiLogPerformanceMetrics,
  byteLength,
  elapsedMs,
  mergePerformanceMetrics,
  probeNow,
} from "./performance-probe";

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
  endpointCredentialId: number;
  supplierId?: string | null;
  endpointId: string;
  modelId: string;
  upstreamId?: number | null;
  upstreamName?: string | null;
  upstreamBaseUrl?: string | null;
  inputPrice: string;
  outputPrice: string;
  requestId: string;
  statusCode: number;
  error?: string;
  /** Serialized request body — for request logging (if logging is enabled). */
  requestBody?: string;
  /** Raw response body — for request logging. */
  responseBody?: string;
  performanceMetrics?: AiLogPerformanceMetrics;
  includeBillingInLatency?: boolean;
  /**
   * When true, limit/balance failures are returned to the caller before usage
   * logs are written. Use for non-streaming responses that can still return
   * 402/429 to the client. Streaming callers should leave this false because
   * the response has already been sent.
   */
  rejectOnLimit?: boolean;
}

export interface ConsumerBillingFailure {
  ok: false;
  statusCode: 402 | 429;
  body: Record<string, unknown>;
  upstreamCost: string;
  costStr: string;
}

export interface ConsumerBillingSuccess {
  ok: true;
  upstreamCost: string;
  costStr: string;
}

export type ConsumerBillingResult = ConsumerBillingSuccess | ConsumerBillingFailure;

export interface SpendingLimitFailure {
  statusCode: 429;
  body: Record<string, unknown>;
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

// ── Spending Limits ──────────────────────────────────────────────────

export async function checkConsumerSpendingLimits(
  consumer: ConsumerBillingContext,
): Promise<SpendingLimitFailure | null> {
  if (consumer.dailyLimit) {
    const spentToday = await payAgentTransactionRepo.sumSpendingToday(consumer.agentId);
    if (gt(spentToday, consumer.dailyLimit)) {
      return {
        statusCode: 429,
        body: {
          error: "Daily spending limit exceeded",
          limit: consumer.dailyLimit,
          spent: spentToday,
        },
      };
    }
  }

  if (consumer.monthlyLimit) {
    const spentMonth = await payAgentTransactionRepo.sumSpendingThisMonth(consumer.agentId);
    if (gt(spentMonth, consumer.monthlyLimit)) {
      return {
        statusCode: 429,
        body: {
          error: "Monthly spending limit exceeded",
          limit: consumer.monthlyLimit,
          spent: spentMonth,
        },
      };
    }
  }

  return null;
}

async function checkCostLimits(
  consumer: ConsumerBillingContext,
  costStr: string,
): Promise<Omit<ConsumerBillingFailure, "upstreamCost" | "costStr"> | null> {
  if (consumer.perPayLimit && gt(costStr, consumer.perPayLimit)) {
    return {
      ok: false,
      statusCode: 429,
      body: {
        error: "Request cost exceeds per-transaction limit",
        limit: consumer.perPayLimit,
        cost: costStr,
      },
    };
  }

  if (consumer.dailyLimit) {
    const spentToday = await payAgentTransactionRepo.sumSpendingToday(consumer.agentId);
    if (gt(safePlus(spentToday, costStr), consumer.dailyLimit)) {
      return {
        ok: false,
        statusCode: 429,
        body: {
          error: "Request would exceed daily spending limit",
          limit: consumer.dailyLimit,
          spent: spentToday,
          cost: costStr,
        },
      };
    }
  }

  if (consumer.monthlyLimit) {
    const spentMonth = await payAgentTransactionRepo.sumSpendingThisMonth(consumer.agentId);
    if (gt(safePlus(spentMonth, costStr), consumer.monthlyLimit)) {
      return {
        ok: false,
        statusCode: 429,
        body: {
          error: "Request would exceed monthly spending limit",
          limit: consumer.monthlyLimit,
          spent: spentMonth,
          cost: costStr,
        },
      };
    }
  }

  return null;
}

async function suspendAgentForLimit(
  consumer: ConsumerBillingContext,
  costStr: string,
  body: Record<string, unknown>,
): Promise<void> {
  log.gateway.warn(
    { agentId: consumer.agentId, cost: costStr, limitError: body.error },
    "AI request exceeded consumer spending limit — suspending agent",
  );
  await payAgentRepo.update(consumer.agentId, { status: "suspended" });
  emit(DOMAIN_EVENT_TYPES.AGENT_SUSPENDED, null, { agentId: consumer.agentId });
}

// ── Billing Pipeline ───────────────────────────────────────────────

/**
 * Shared billing logic for consumer AI usage — debit balance, log usage, log request body.
 *
 * Used by all consumer relay paths (chat/completions + passthrough, streaming + non-streaming).
 */
export async function billConsumer(p: BillConsumerParams): Promise<ConsumerBillingResult> {
  const billingStart = probeNow();
  const { upstreamCost, costStr } = calculateConsumerCost(
    p.usage,
    p.inputPrice,
    p.outputPrice,
    p.consumer.markupPercent,
  );

  const isPaidModel = gt(p.inputPrice, "0") || gt(p.outputPrice, "0");
  if (isPaidModel && !p.usage && p.statusCode === 200) {
    log.gateway.warn(
      {
        agentId: p.consumer.agentId,
        consumerKeyId: p.consumer.consumerId,
        endpointCredentialId: p.endpointCredentialId,
        supplierId: p.supplierId ?? null,
        endpointId: p.endpointId,
        modelId: p.modelId,
        upstreamId: p.upstreamId,
        upstreamName: p.upstreamName,
        requestId: p.requestId,
      },
      "Paid model returned no usage — billing skipped (upstream may be misconfigured)",
    );
  }

  const limitFailure = await checkCostLimits(p.consumer, costStr);
  if (limitFailure) {
    if (p.rejectOnLimit) {
      return { ...limitFailure, upstreamCost, costStr };
    }
    await suspendAgentForLimit(p.consumer, costStr, limitFailure.body);
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
        endpointCredentialId: p.endpointCredentialId,
      } as Record<string, unknown>);
    } else {
      log.gateway.warn(
        { agentId: p.consumer.agentId, cost: costStr },
        "AI debit failed — suspending agent",
      );
      await payAgentRepo.update(p.consumer.agentId, { status: "suspended" });
      emit(DOMAIN_EVENT_TYPES.AGENT_SUSPENDED, null, { agentId: p.consumer.agentId });
      if (p.rejectOnLimit) {
        return {
          ok: false,
          statusCode: 402,
          body: { error: "Agent balance exhausted. Please top up the pay-agent." },
          upstreamCost,
          costStr,
        };
      }
    }
  }

  // Log usage
  const billingMs = elapsedMs(billingStart);
  const performanceMetrics = mergePerformanceMetrics(p.performanceMetrics, {
    billingMs,
    requestBytes: p.performanceMetrics?.requestBytes ?? byteLength(p.requestBody),
    responseBytes: p.performanceMetrics?.responseBytes ?? byteLength(p.responseBody),
  });
  enqueueJob("ai-usage-log", {
    endpointCredentialId: p.endpointCredentialId,
    consumerKeyId: p.consumer.consumerId,
    userId: p.consumer.userId,
    supplierId: p.supplierId ?? null,
    endpointId: p.endpointId,
    modelId: p.modelId,
    upstreamId: p.upstreamId ?? null,
    upstreamName: p.upstreamName ?? null,
    upstreamBaseUrl: p.upstreamBaseUrl ?? null,
    inputTokens: p.usage?.inputTokens ?? 0,
    outputTokens: p.usage?.outputTokens ?? 0,
    totalTokens: p.usage?.totalTokens ?? 0,
    cacheCreationInputTokens: p.usage?.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: p.usage?.cacheReadInputTokens ?? 0,
    estimatedCost: costStr,
    upstreamCost: removeTailingZero(upstreamCost, 6),
    markupPercent: p.consumer.markupPercent,
    latencyMs: p.includeBillingInLatency ? p.latencyMs + billingMs : p.latencyMs,
    ...performanceMetrics,
    statusCode: p.statusCode,
    requestId: p.requestId,
    error: p.error ?? null,
  } as Record<string, unknown>);
  enqueueJob("consumer-key-touch", { consumerId: p.consumer.consumerId });
  enqueueJob("ai-endpoint-credential-touch", { endpointCredentialId: p.endpointCredentialId });

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

  return { ok: true, upstreamCost, costStr };
}
