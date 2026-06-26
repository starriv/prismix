import { log } from "@/server/lib/logger";
import { registerBatchHandler, registerWriteHandler } from "@/server/lib/write-queue";
import {
  aiKeyRepo,
  aiUsageLogRepo,
  keyProviderRepo,
  keyProviderTransactionRepo,
  payAgentTransactionRepo,
  relayConsumerKeyRepo,
} from "@/server/repos";
import { gt, removeTailingZero, safeMinus, safeMultipliedBy } from "@/shared/number";

import { type RequestLogEntry, saveRequestLog } from "./log-store";
import { anthropicAdapter } from "./providers/anthropic";
import { azureOpenaiAdapter } from "./providers/azure-openai";
import { bedrockAdapter } from "./providers/bedrock";
import { geminiAdapter } from "./providers/gemini";
import { openaiAdapter } from "./providers/openai";
import { registerAdapter } from "./providers/registry";

export function initAiAdapters(): void {
  registerAdapter(openaiAdapter);
  registerAdapter(anthropicAdapter);
  registerAdapter(geminiAdapter);
  registerAdapter(azureOpenaiAdapter);
  registerAdapter(bedrockAdapter);
}

export function initAiWriteHandlers(): void {
  // Accumulates logs in memory, flushes as multi-row INSERT every 1s or 50 entries.
  registerBatchHandler(
    "ai-usage-log",
    async (batch) => {
      const keyIds = Array.from(
        new Set(
          batch
            .map((data) => data.keyId as number | null | undefined)
            .filter((id): id is number => typeof id === "number" && id > 0),
        ),
      );
      const keys = await aiKeyRepo.findByIds(keyIds);
      const ownerIdByKeyId = new Map(keys.map((key) => [key.id, key.ownerId ?? null]));

      await aiUsageLogRepo.insertMany(
        batch.map((data) => ({
          keyId: (data.keyId as number) ?? null,
          keyOwnerId:
            (data.keyId as number | null | undefined) != null
              ? (ownerIdByKeyId.get(data.keyId as number) ?? null)
              : null,
          consumerKeyId: (data.consumerKeyId as number) ?? null,
          userId: (data.userId as number) ?? null,
          providerId: data.providerId as string,
          modelId: data.modelId as string,
          upstreamId: (data.upstreamId as number) ?? null,
          upstreamName: (data.upstreamName as string) ?? null,
          upstreamBaseUrl: (data.upstreamBaseUrl as string) ?? null,
          inputTokens: (data.inputTokens as number) ?? 0,
          outputTokens: (data.outputTokens as number) ?? 0,
          totalTokens: (data.totalTokens as number) ?? 0,
          cacheCreationInputTokens: (data.cacheCreationInputTokens as number) ?? 0,
          cacheReadInputTokens: (data.cacheReadInputTokens as number) ?? 0,
          estimatedCost: (data.estimatedCost as string) ?? null,
          upstreamCost: (data.upstreamCost as string) ?? null,
          markupPercent: (data.markupPercent as number) ?? null,
          latencyMs: (data.latencyMs as number) ?? null,
          statusCode: (data.statusCode as number) ?? null,
          requestId: (data.requestId as string) ?? null,
          error: (data.error as string) ?? null,
        })),
      );
    },
    { maxSize: 50, flushIntervalMs: 1000 },
  );

  registerWriteHandler("ai-key-touch", async (data) => {
    await aiKeyRepo.updateLastUsed(data.keyId as number);
  });

  registerWriteHandler("agent-ai-txn", async (data) => {
    await payAgentTransactionRepo.insert({
      agentId: data.agentId as number,
      userId: (data.userId as number) ?? null,
      type: data.type as string,
      amount: data.amount as string,
      balanceBefore: data.balanceBefore as string,
      balanceAfter: data.balanceAfter as string,
      referenceType: (data.referenceType as string) ?? null,
      description: (data.description as string) ?? null,
      source: (data.source as string) ?? "platform",
      consumerKeyId: (data.consumerKeyId as number) ?? null,
      modelId: (data.modelId as string) ?? null,
      tokens: (data.tokens as number) ?? null,
      requestId: (data.requestId as string) ?? null,
      upstreamCost: (data.upstreamCost as string) ?? null,
      markupPercent: (data.markupPercent as number) ?? null,
    });

    const aiKeyId = data.aiKeyId as number | undefined;
    const upstreamCost = data.upstreamCost as string | undefined;
    const consumerCost = data.amount as string | undefined;
    if (aiKeyId && upstreamCost && consumerCost) {
      try {
        const aiKey = await aiKeyRepo.findById(aiKeyId);
        if (aiKey?.ownerId) {
          const provider = await keyProviderRepo.findById(aiKey.ownerId);
          if (provider && provider.status === "active") {
            const platformProfit = safeMinus(consumerCost, upstreamCost);
            if (gt(platformProfit, "0")) {
              const share = removeTailingZero(
                safeMultipliedBy(platformProfit, provider.revenueSharePercent / 100),
                6,
              );
              if (gt(share, "0")) {
                const updated = await keyProviderRepo.creditBalance(provider.id, share);
                await keyProviderTransactionRepo.insert({
                  providerId: provider.id,
                  keyId: aiKeyId,
                  type: "revenue_share",
                  amount: share,
                  balanceBefore: safeMinus(updated.balance, share),
                  balanceAfter: updated.balance,
                  description: `Revenue share: ${data.modelId ?? "unknown"} (${data.tokens ?? 0} tokens)`,
                  requestId: (data.requestId as string) ?? null,
                });
              }
            }
          }
        }
      } catch (err) {
        log.gateway.error({ err, aiKeyId }, "Failed to process key provider revenue share");
      }
    }
  });

  registerWriteHandler("consumer-key-touch", async (data) => {
    await relayConsumerKeyRepo.updateLastUsed(data.consumerId as number);
  });

  // Batch handler: buffers in-process, bypasses BullMQ entirely in monolith mode.
  // Prevents full request/response bodies from accumulating as BullMQ job payloads in Redis
  // (the final write destination is RedisRequestLogStore, not BullMQ).
  registerBatchHandler(
    "ai-request-log",
    async (batch) => {
      await Promise.allSettled(
        batch.map((data) => saveRequestLog(data as unknown as RequestLogEntry)),
      );
    },
    { maxSize: 20, flushIntervalMs: 2_000 },
  );
}
