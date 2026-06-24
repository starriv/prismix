import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { log } from "@/server/lib/logger";

const RESOURCE_DOWN_ALERT_COOLDOWN_MS =
  Number(process.env.RESOURCE_DOWN_ALERT_COOLDOWN_MS) || 5 * 60 * 1000;

const lastResourceDownAlertAt = new Map<string, number>();

export interface ResourceDownAlertInput {
  route: "admin-chat" | "admin-passthrough" | "consumer-chat" | "consumer-passthrough";
  requestId: string;
  providerId: string | null;
  providerName?: string | null;
  modelId?: string | null;
  upstreamId?: number | null;
  upstreamName?: string | null;
  upstreamBaseUrl?: string | null;
  status?: number | null;
  detail?: string | null;
}

export function notifyResourceDown(input: ResourceDownAlertInput): void {
  const now = Date.now();
  const key = buildResourceDownDedupeKey(input);
  const previous = lastResourceDownAlertAt.get(key) ?? 0;
  if (now - previous < RESOURCE_DOWN_ALERT_COOLDOWN_MS) {
    return;
  }
  lastResourceDownAlertAt.set(key, now);

  const title = `AI 上游不可用: ${input.upstreamName ?? input.providerName ?? input.providerId ?? "unknown"}`;
  const body = buildResourceDownBody(input);
  emit(DOMAIN_EVENT_TYPES.ALERT_RESOURCE_DOWN, null, {
    ...input,
    title,
    body,
    cooldownMs: RESOURCE_DOWN_ALERT_COOLDOWN_MS,
  });
  log.gateway.warn(
    {
      route: input.route,
      requestId: input.requestId,
      providerId: input.providerId,
      modelId: input.modelId,
      upstreamId: input.upstreamId,
      status: input.status,
      detail: input.detail,
    },
    "Emitted resource-down alert after all upstream candidates failed",
  );
}

function buildResourceDownDedupeKey(input: ResourceDownAlertInput): string {
  return [
    input.route,
    input.providerId ?? "unknown-provider",
    input.upstreamId ?? "legacy",
    input.modelId ?? "unknown-model",
  ].join(":");
}

function buildResourceDownBody(input: ResourceDownAlertInput): string {
  const rows = [
    "实际推理请求已耗尽所有可用上游候选，网关返回 All upstream candidates failed。",
    "",
    "详细信息:",
    `路由: ${input.route}`,
    `请求 ID: ${input.requestId}`,
  ];
  if (input.providerId) rows.push(`供应商: ${input.providerName ?? input.providerId}`);
  if (input.modelId) rows.push(`模型: ${input.modelId}`);
  if (input.upstreamId != null) rows.push(`上游 ID: ${input.upstreamId}`);
  if (input.upstreamName) rows.push(`上游名称: ${input.upstreamName}`);
  if (input.upstreamBaseUrl) rows.push(`Base URL: ${input.upstreamBaseUrl}`);
  if (input.status != null && input.status > 0) rows.push(`最后状态码: ${input.status}`);
  if (input.detail) rows.push(`最后错误: ${input.detail}`);
  return rows.join("\n");
}

export function resetRuntimeAlertDedupeForTests(): void {
  lastResourceDownAlertAt.clear();
}
