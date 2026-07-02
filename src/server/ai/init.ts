import { log } from "@/server/lib/logger";
import { registerBatchHandler, registerWriteHandler } from "@/server/lib/write-queue";
import {
  aiEndpointCredentialRepo,
  aiEndpointRepo,
  aiSupplierRepo,
  aiUsageLogRepo,
  keyProviderRepo,
  keyProviderTransactionRepo,
  payAgentTransactionRepo,
  relayConsumerKeyRepo,
} from "@/server/repos";
import { gt, removeTailingZero, safeMinus, safeMultipliedBy } from "@/shared/number";

import { type RequestLogEntry, saveRequestLog } from "./log-store";
import { anthropicAdapter } from "./protocol-adapters/anthropic";
import { azureOpenaiAdapter } from "./protocol-adapters/azure-openai";
import { bedrockAdapter } from "./protocol-adapters/bedrock";
import { geminiAdapter } from "./protocol-adapters/gemini";
import { openaiAdapter } from "./protocol-adapters/openai";
import { registerAdapter } from "./protocol-adapters/registry";

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
      const endpointCredentialIds = Array.from(
        new Set(
          batch
            .map((data) => data.endpointCredentialId as number | null | undefined)
            .filter((id): id is number => typeof id === "number" && id > 0),
        ),
      );
      const endpointCredentials = await aiEndpointCredentialRepo.findByIds(endpointCredentialIds);
      const ownerIdByEndpointCredentialId = new Map(
        endpointCredentials.map((credential) => [credential.id, credential.ownerId ?? null]),
      );
      const credentialIdByEndpointCredentialId = new Map(
        endpointCredentials.map((credential) => [credential.id, credential.credentialId]),
      );
      const endpointNumericIds = [
        ...new Set(endpointCredentials.map((credential) => credential.endpointId)),
      ];
      const endpoints = await aiEndpointRepo.findByIds(endpointNumericIds);
      const endpointSlugById = new Map(
        endpoints.map((endpoint) => [endpoint.id, endpoint.endpointId]),
      );
      const endpointIdByEndpointCredentialId = new Map(
        endpointCredentials.map((credential) => [credential.id, credential.endpointId]),
      );
      const supplierNumericIds = [...new Set(endpoints.map((endpoint) => endpoint.supplierId))];
      const suppliers = await aiSupplierRepo.findByIds(supplierNumericIds);
      const supplierSlugById = new Map(
        suppliers.map((supplier) => [supplier.id, supplier.supplierId]),
      );
      const supplierSlugByEndpointId = new Map(
        endpoints.map((endpoint) => [
          endpoint.id,
          supplierSlugById.get(endpoint.supplierId) ?? null,
        ]),
      );

      await aiUsageLogRepo.insertMany(
        batch.map((data) => {
          const endpointCredentialId =
            (data.endpointCredentialId as number | null | undefined) ?? null;
          const endpointNumericId =
            endpointCredentialId != null
              ? (endpointIdByEndpointCredentialId.get(endpointCredentialId) ?? null)
              : null;

          return {
            endpointCredentialId,
            credentialId:
              (data.credentialId as number | null | undefined) ??
              (endpointCredentialId != null
                ? (credentialIdByEndpointCredentialId.get(endpointCredentialId) ?? null)
                : null),
            credentialOwnerId:
              (data.credentialOwnerId as number | null | undefined) ??
              (endpointCredentialId != null
                ? (ownerIdByEndpointCredentialId.get(endpointCredentialId) ?? null)
                : null),
            consumerKeyId: (data.consumerKeyId as number) ?? null,
            userId: (data.userId as number) ?? null,
            supplierId:
              (data.supplierId as string | null | undefined) ??
              (endpointNumericId != null
                ? (supplierSlugByEndpointId.get(endpointNumericId) ?? null)
                : null),
            endpointId:
              (data.endpointId as string | null | undefined) ??
              (endpointNumericId != null
                ? (endpointSlugById.get(endpointNumericId) ?? null)
                : null),
            modelId: data.modelId as string,
            upstreamId: (data.upstreamId as number) ?? null,
            upstreamName: (data.upstreamName as string) ?? null,
            upstreamBaseUrl: (data.upstreamBaseUrl as string) ?? null,
            inputTokens: (data.inputTokens as number) ?? 0,
            outputTokens: (data.outputTokens as number) ?? 0,
            totalTokens: (data.totalTokens as number) ?? 0,
            cacheCreationInputTokens: (data.cacheCreationInputTokens as number) ?? 0,
            cacheReadInputTokens: (data.cacheReadInputTokens as number) ?? 0,
            reasoningTokens: (data.reasoningTokens as number) ?? 0,
            estimatedCost: (data.estimatedCost as string) ?? null,
            upstreamCost: (data.upstreamCost as string) ?? null,
            markupPercent: (data.markupPercent as number) ?? null,
            latencyMs: (data.latencyMs as number) ?? null,
            routeType: (data.routeType as string) ?? null,
            isStream: (data.isStream as boolean) ?? null,
            cacheStatus: (data.cacheStatus as string) ?? null,
            cacheLookupMs: (data.cacheLookupMs as number) ?? null,
            cacheWriteMs: (data.cacheWriteMs as number) ?? null,
            routingMs: (data.routingMs as number) ?? null,
            queueWaitMs: (data.queueWaitMs as number) ?? null,
            upstreamTtfbMs: (data.upstreamTtfbMs as number) ?? null,
            upstreamBodyMs: (data.upstreamBodyMs as number) ?? null,
            transformMs: (data.transformMs as number) ?? null,
            billingMs: (data.billingMs as number) ?? null,
            firstChunkMs: (data.firstChunkMs as number) ?? null,
            firstTokenMs: (data.firstTokenMs as number) ?? null,
            tokensPerSecond: (data.tokensPerSecond as number) ?? null,
            requestBytes: (data.requestBytes as number) ?? null,
            responseBytes: (data.responseBytes as number) ?? null,
            streamChunks: (data.streamChunks as number) ?? null,
            streamBytes: (data.streamBytes as number) ?? null,
            streamPingCount: (data.streamPingCount as number) ?? null,
            streamAbortReason: (data.streamAbortReason as string) ?? null,
            attemptCount: (data.attemptCount as number) ?? 1,
            retryCount: (data.retryCount as number) ?? 0,
            statusCode: (data.statusCode as number) ?? null,
            requestId: (data.requestId as string) ?? null,
            error: (data.error as string) ?? null,
          };
        }),
      );
    },
    { maxSize: 50, flushIntervalMs: 1000 },
  );

  registerWriteHandler("ai-endpoint-credential-touch", async (data) => {
    await aiEndpointCredentialRepo.updateLastUsed(data.endpointCredentialId as number);
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

    const endpointCredentialId = data.endpointCredentialId as number | undefined;
    const upstreamCost = data.upstreamCost as string | undefined;
    const consumerCost = data.amount as string | undefined;
    if (endpointCredentialId && upstreamCost && consumerCost) {
      try {
        const endpointCredential = await aiEndpointCredentialRepo.findById(endpointCredentialId);
        if (endpointCredential?.ownerId) {
          const provider = await keyProviderRepo.findById(endpointCredential.ownerId);
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
                  credentialId: endpointCredential.credentialId,
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
        log.gateway.error(
          { err, endpointCredentialId },
          "Failed to process credential provider revenue share",
        );
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
