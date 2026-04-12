/**
 * AI Module barrel — single entry point for external consumers.
 *
 * Internal AI module files import each other via relative paths.
 * Everything outside `src/server/ai/` imports from this barrel.
 */
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

// ── Key balancer ───────────────────────────────────────────────────────

export { invalidateKeyPool } from "./lib/key-balancer";

// ── Routes ──────────────────────────────────────────────────────────────

export { default as adminAiRouter } from "./routes/admin-ai";
export { default as adminAiProvidersRouter } from "./routes/admin-ai-providers";
export { default as adminAiModelsRouter } from "./routes/admin-ai-models";
export { default as adminAiKeysRouter } from "./routes/admin-ai-keys";
export { default as aiRelayRouter } from "./routes/relay";
export { default as aiMcpRouter } from "./routes/mcp";
export { default as consumerRelayRouter } from "./routes/consumer-relay";
export { default as relayKeysRouter } from "./routes/relay-keys";
export { consumerKeyAuthMiddleware } from "./middleware/consumer-key-auth";

// ── Init ────────────────────────────────────────────────────────────────

/**
 * Initialize the AI relay subsystem:
 * - Register provider adapters
 * - Register async write handlers for usage logging + key touch
 */
export function initAiRelay(): void {
  // -- Adapters --
  registerAdapter(openaiAdapter);
  registerAdapter(anthropicAdapter);
  registerAdapter(geminiAdapter);
  registerAdapter(azureOpenaiAdapter);
  registerAdapter(bedrockAdapter);

  // -- Batch write handler for AI usage logs --
  // Accumulates logs in memory, flushes as multi-row INSERT every 1s or 50 entries.
  registerBatchHandler(
    "ai-usage-log",
    async (batch) => {
      await aiUsageLogRepo.insertMany(
        batch.map((data) => ({
          keyId: (data.keyId as number) ?? null,
          consumerKeyId: (data.consumerKeyId as number) ?? null,
          userId: (data.userId as number) ?? null,
          providerId: data.providerId as string,
          modelId: data.modelId as string,
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

  // -- Consumer key handlers --
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

    // -- Key provider revenue share --
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

  registerWriteHandler("ai-request-log", async (data) => {
    await saveRequestLog(data as unknown as RequestLogEntry);
  });
}
