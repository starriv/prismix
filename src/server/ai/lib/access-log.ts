import { enqueueJob } from "@/server/lib/write-queue";

export interface AiAccessLogParams {
  requestId: string;
  statusCode: number;
  error: string;
  keyId?: number | null;
  consumerKeyId?: number | null;
  userId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: string | null;
  upstreamCost?: string | null;
  markupPercent?: number | null;
  latencyMs?: number | null;
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
  enqueueJob("ai-usage-log", {
    keyId: params.keyId ?? null,
    consumerKeyId: params.consumerKeyId ?? null,
    userId: params.userId ?? null,
    providerId: params.providerId ?? null,
    modelId: params.modelId ?? null,
    inputTokens: params.inputTokens ?? 0,
    outputTokens: params.outputTokens ?? 0,
    totalTokens: params.totalTokens ?? 0,
    estimatedCost: params.estimatedCost ?? null,
    upstreamCost: params.upstreamCost ?? null,
    markupPercent: params.markupPercent ?? null,
    latencyMs: params.latencyMs ?? null,
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
