import { enqueueJob } from "@/server/lib/write-queue";

import {
  type AiLogPerformanceMetrics,
  byteLength,
  mergePerformanceMetrics,
} from "./performance-probe";

export interface AiAccessLogParams {
  requestId: string;
  statusCode: number;
  error: string;
  endpointCredentialId?: number | null;
  credentialId?: number | null;
  credentialOwnerId?: number | null;
  consumerKeyId?: number | null;
  userId?: number | null;
  supplierId?: string | null;
  endpointId?: string | null;
  modelId?: string | null;
  upstreamId?: number | null;
  upstreamName?: string | null;
  upstreamBaseUrl?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: string | null;
  upstreamCost?: string | null;
  markupPercent?: number | null;
  latencyMs?: number | null;
  performanceMetrics?: AiLogPerformanceMetrics;
  requestBody?: string;
  responseBody?: string;
}

export function buildAccessLogErrorMessage(error: string, detail?: unknown): string {
  if (typeof detail === "string" && detail.trim().length > 0) {
    return `${error}\n\n${detail.trim()}`;
  }
  if (detail && typeof detail === "object") {
    return `${error}\n\n${JSON.stringify(detail)}`;
  }
  return error;
}

export function enqueueAiAccessLog(params: AiAccessLogParams): void {
  const performanceMetrics = mergePerformanceMetrics(params.performanceMetrics, {
    requestBytes: params.performanceMetrics?.requestBytes ?? byteLength(params.requestBody),
    responseBytes: params.performanceMetrics?.responseBytes ?? byteLength(params.responseBody),
  });
  enqueueJob("ai-usage-log", {
    endpointCredentialId: params.endpointCredentialId ?? null,
    credentialId: params.credentialId ?? null,
    credentialOwnerId: params.credentialOwnerId ?? null,
    consumerKeyId: params.consumerKeyId ?? null,
    userId: params.userId ?? null,
    supplierId: params.supplierId ?? null,
    endpointId: params.endpointId ?? null,
    modelId: params.modelId ?? null,
    upstreamId: params.upstreamId ?? null,
    upstreamName: params.upstreamName ?? null,
    upstreamBaseUrl: params.upstreamBaseUrl ?? null,
    inputTokens: params.inputTokens ?? 0,
    outputTokens: params.outputTokens ?? 0,
    totalTokens: params.totalTokens ?? 0,
    estimatedCost: params.estimatedCost ?? null,
    upstreamCost: params.upstreamCost ?? null,
    markupPercent: params.markupPercent ?? null,
    latencyMs: params.latencyMs ?? null,
    ...performanceMetrics,
    statusCode: params.statusCode,
    requestId: params.requestId,
    error: params.error,
  } as Record<string, unknown>);

  if (params.requestBody) {
    enqueueJob("ai-request-log", {
      requestId: params.requestId,
      consumerKeyId: params.consumerKeyId ?? null,
      modelId: params.modelId ?? "unknown",
      requestBody: params.requestBody,
      responseBody: params.responseBody ?? "",
      createdAt: new Date().toISOString(),
    } as Record<string, unknown>);
  }
}
