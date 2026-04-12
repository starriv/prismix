import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { GatewayConfig } from "./ai-schemas";
import { del, get, post, put } from "./client";
import {
  API_ADMIN_GATEWAY_CONFIG,
  API_ADMIN_GATEWAY_STATUS,
  API_AI_DEFAULT_MARKUP,
  API_AI_KEYS,
  API_AI_PROVIDERS,
  API_AI_REQUEST_LOGGING,
  API_AI_USAGE_BY_KEY,
  API_AI_USAGE_DAILY,
  API_AI_USAGE_RECENT,
  API_AI_USAGE_SUMMARY,
  API_RELAY_KEYS,
  apiAiDiscoverModels,
  apiAiKeyDetail,
  apiAiKeyTest,
  apiAiModelDetail,
  apiAiProviderDetail,
  apiAiProviderModels,
  apiAiProviderModelsBatch,
  apiAiSyncPricesApply,
  apiAiSyncPricesPreview,
  apiAiUsageRequest,
  apiRelayKeyDetail,
  apiRelayKeyReveal,
  apiRelayKeyRotate,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import {
  aiDailyUsageSchema,
  aiKeySchema,
  aiModelSchema,
  aiProviderSchema,
  aiRequestLogSchema,
  aiUsageByKeySchema,
  aiUsageRecordSchema,
  aiUsageSummarySchema,
  discoveredModelSchema,
  gatewayConfigSchema,
  gatewayStatusSchema,
  priceDiffSchema,
  relayConsumerKeySchema,
  testAiKeyResultSchema,
} from "./schemas";

// ── AI Providers ──────────────────────────────────────────────────────

export function useAiProviders() {
  return useQuery({
    queryKey: queryKeys.aiProviders(),
    queryFn: () => get(API_AI_PROVIDERS, z.array(aiProviderSchema)),
  });
}

interface CreateAiProviderBody {
  providerId: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  enabled?: boolean;
  loadBalanceStrategy?: string;
}

export function useCreateAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAiProviderBody) => post(API_AI_PROVIDERS, body, aiProviderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviders() });
    },
  });
}

export function useUpdateAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<CreateAiProviderBody>) =>
      put(apiAiProviderDetail(id), body, aiProviderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviders() });
    },
  });
}

export function useDeleteAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiAiProviderDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviders() });
    },
  });
}

// ── AI Keys ───────────────────────────────────────────────────────────

export function useAiKeys() {
  return useQuery({
    queryKey: queryKeys.aiKeys(),
    queryFn: () => get(API_AI_KEYS, z.array(aiKeySchema)),
  });
}

export function useCreateAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      providerId: number;
      name: string;
      apiKey: string;
      ownerId?: number | null;
    }) => post(API_AI_KEYS, body, aiKeySchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
    },
  });
}

export function useUpdateAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      name?: string;
      enabled?: boolean;
      weight?: number;
      ownerId?: number | null;
    }) => put(apiAiKeyDetail(id), body, aiKeySchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
    },
  });
}

export function useDeleteAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiAiKeyDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
    },
  });
}

export function useTestAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(apiAiKeyTest(id), {}, testAiKeyResultSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
    },
  });
}

// ── AI Models ─────────────────────────────────────────────────────────

export function useAiModels(providerId: number) {
  return useQuery({
    queryKey: queryKeys.aiProviderModels(providerId),
    queryFn: () => get(apiAiProviderModels(providerId), z.array(aiModelSchema)),
    enabled: providerId > 0,
  });
}

interface CreateAiModelBody {
  modelId: string;
  name: string;
  contextWindow?: number | null;
  inputPrice: string;
  outputPrice: string;
  capabilities: string[];
  enabled?: boolean;
}

export function useCreateAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, ...body }: { providerId: number } & CreateAiModelBody) =>
      post(apiAiProviderModels(providerId), body, aiModelSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
    },
  });
}

export function useBatchCreateAiModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      models,
    }: {
      providerId: number;
      models: Array<{
        modelId: string;
        name: string;
        inputPrice?: string;
        outputPrice?: string;
        capabilities?: string[];
        enabled?: boolean;
      }>;
    }) =>
      post(
        apiAiProviderModelsBatch(providerId),
        { models },
        z.object({ created: z.number(), models: z.array(aiModelSchema) }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
    },
  });
}

export function useUpdateAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      providerId: _pid,
      ...body
    }: { id: number; providerId: number } & Partial<CreateAiModelBody>) =>
      put(apiAiModelDetail(id), body, aiModelSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
    },
  });
}

export function useDeleteAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, providerId: _pid }: { id: number; providerId: number }) =>
      del(apiAiModelDetail(id), z.object({ success: z.boolean() })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
    },
  });
}

export function useDiscoverModels(providerId: number) {
  return useQuery({
    queryKey: queryKeys.aiDiscoverModels(providerId),
    queryFn: () => get(apiAiDiscoverModels(providerId), z.array(discoveredModelSchema)),
    enabled: false,
  });
}

export function usePreviewSyncPrices() {
  return useMutation({
    mutationFn: ({ providerId }: { providerId: number }) =>
      post(apiAiSyncPricesPreview(providerId), {}, z.array(priceDiffSchema)),
  });
}

export function useApplySyncPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, modelIds }: { providerId: number; modelIds: number[] }) =>
      post(apiAiSyncPricesApply(providerId), { modelIds }, z.object({ synced: z.number() })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
    },
  });
}

// ── AI Usage ──────────────────────────────────────────────────────────

export function useAiUsageSummary(refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageSummary(),
    queryFn: () => get(API_AI_USAGE_SUMMARY, aiUsageSummarySchema),
    refetchInterval,
  });
}

export function useAiUsageRecent(refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageRecent(),
    queryFn: () => get(API_AI_USAGE_RECENT, z.array(aiUsageRecordSchema)),
    refetchInterval,
  });
}

export function useAiUsageDaily(days = 30, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageDaily(days),
    queryFn: () => get(`${API_AI_USAGE_DAILY}?days=${days}`, z.array(aiDailyUsageSchema)),
    refetchInterval,
  });
}

export function useAiUsageByKey() {
  return useQuery({
    queryKey: queryKeys.aiUsageByKey(),
    queryFn: () => get(API_AI_USAGE_BY_KEY, z.array(aiUsageByKeySchema)),
  });
}

export function useAiUsageSummaryByKey(keyId: number, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageSummaryByKey(keyId),
    queryFn: () => get(`${API_AI_USAGE_SUMMARY}?consumerKeyId=${keyId}`, aiUsageSummarySchema),
    refetchInterval,
  });
}

export function useAiUsageRecentByKey(keyId: number, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageRecentByKey(keyId),
    queryFn: () =>
      get(`${API_AI_USAGE_RECENT}?consumerKeyId=${keyId}`, z.array(aiUsageRecordSchema)),
    refetchInterval,
  });
}

export function useAiUsageDailyByKey(keyId: number, days = 30) {
  return useQuery({
    queryKey: queryKeys.aiUsageDailyByKey(keyId, days),
    queryFn: () =>
      get(`${API_AI_USAGE_DAILY}?consumerKeyId=${keyId}&days=${days}`, z.array(aiDailyUsageSchema)),
  });
}

export function useAiLogs(opts?: {
  consumerKeyId?: number;
  modelId?: string;
  providerId?: string;
  page?: number;
  refetchInterval?: number | false;
}) {
  const page = opts?.page ?? 0;
  const params = new URLSearchParams();
  if (opts?.consumerKeyId != null) params.set("consumerKeyId", String(opts.consumerKeyId));
  if (opts?.modelId) params.set("modelId", opts.modelId);
  if (opts?.providerId) params.set("providerId", opts.providerId);
  params.set("limit", String(DEFAULT_PAGE_SIZE));
  params.set("offset", String(page * DEFAULT_PAGE_SIZE));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.aiLogs({
      consumerKeyId: opts?.consumerKeyId,
      modelId: opts?.modelId,
      providerId: opts?.providerId,
      page,
    }),
    queryFn: () => get(`${API_AI_USAGE_RECENT}?${qs}`, z.array(aiUsageRecordSchema)),
    placeholderData: keepPreviousData,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useAiRequestLog(requestId: string | null) {
  return useQuery({
    queryKey: queryKeys.aiRequestLog(requestId ?? ""),
    queryFn: () => get(apiAiUsageRequest(requestId!), aiRequestLogSchema),
    enabled: !!requestId,
  });
}

// ── AI Request Logging ────────────────────────────────────────────────

export function useAiRequestLogging() {
  return useQuery({
    queryKey: queryKeys.aiRequestLogging(),
    queryFn: () => get(API_AI_REQUEST_LOGGING, z.object({ enabled: z.boolean() })),
  });
}

export function useUpdateAiRequestLogging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      put(API_AI_REQUEST_LOGGING, { enabled }, z.object({ enabled: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiRequestLogging() });
    },
  });
}

export function useAiDefaultMarkup() {
  return useQuery({
    queryKey: queryKeys.aiDefaultMarkup(),
    queryFn: () => get(API_AI_DEFAULT_MARKUP, z.object({ defaultMarkupPercent: z.number() })),
  });
}

export function useUpdateAiDefaultMarkup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defaultMarkupPercent: number) =>
      put(
        API_AI_DEFAULT_MARKUP,
        { defaultMarkupPercent },
        z.object({ defaultMarkupPercent: z.number() }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiDefaultMarkup() });
    },
  });
}

// ── Relay Consumer Keys ───────────────────────────────────────────────

export function useRelayKeys() {
  return useQuery({
    queryKey: queryKeys.relayKeys(),
    queryFn: () => get(API_RELAY_KEYS, z.array(relayConsumerKeySchema)),
  });
}

export function useCreateRelayKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      markupPercent?: number;
      rateLimitRpm?: number;
      allowedModels?: string[];
      initialBalance?: string;
    }) => post(API_RELAY_KEYS, body, relayConsumerKeySchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.relayKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.payAgentsAll() });
    },
  });
}

export function useUpdateRelayKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      name?: string;
      status?: string;
      agentId?: number;
      markupPercent?: number;
      rateLimitRpm?: number | null;
      allowedModels?: string[] | null;
    }) => put(apiRelayKeyDetail(id), body, relayConsumerKeySchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.relayKeys() });
    },
  });
}

const deleteRelayKeyResponseSchema = z.object({
  success: z.boolean(),
  agent: z.object({ id: z.number(), name: z.string(), balance: z.string() }).nullable(),
});

export function useDeleteRelayKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiRelayKeyDetail(id), deleteRelayKeyResponseSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.relayKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.payAgentsAll() });
    },
  });
}

export function useRevealRelayKey() {
  return useMutation({
    mutationFn: (id: number) => post(apiRelayKeyReveal(id), {}, z.object({ apiKey: z.string() })),
  });
}

export function useRotateRelayKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      post(apiRelayKeyRotate(id), {}, z.object({ apiKey: z.string(), apiKeyPrefix: z.string() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.relayKeys() });
    },
  });
}

// ── Gateway Config ──────────────────────────────────────────────────

export function useAdminGatewayConfig() {
  return useQuery({
    queryKey: queryKeys.adminGatewayConfig(),
    queryFn: () => get(API_ADMIN_GATEWAY_CONFIG, gatewayConfigSchema),
  });
}

export function useUpdateAdminGatewayConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<GatewayConfig>) =>
      put(API_ADMIN_GATEWAY_CONFIG, data, gatewayConfigSchema),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.adminGatewayConfig(), data);
    },
  });
}

export function useAdminGatewayStatus() {
  return useQuery({
    queryKey: queryKeys.adminGatewayStatus(),
    queryFn: () => get(API_ADMIN_GATEWAY_STATUS, gatewayStatusSchema),
    refetchInterval: 5_000,
  });
}
