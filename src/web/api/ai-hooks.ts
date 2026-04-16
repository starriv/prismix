import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { GatewayConfig } from "./ai-schemas";
import { del, get, post, put } from "./client";
import {
  API_ADMIN_GATEWAY_CONFIG,
  API_ADMIN_GATEWAY_STATUS,
  API_AI_DEFAULT_MARKUP,
  API_AI_ERROR_DAILY,
  API_AI_ERROR_OVERVIEW,
  API_AI_KEYS,
  API_AI_MODELS,
  API_AI_MODELS_BATCH_DELETE,
  API_AI_PROVIDERS,
  API_AI_REQUEST_LOGGING,
  API_AI_UPSTREAMS,
  API_AI_UPSTREAMS_OVERVIEW,
  API_AI_USAGE_BY_KEY,
  API_AI_USAGE_DAILY,
  API_AI_USAGE_RECENT,
  API_AI_USAGE_SUMMARY,
  API_RELAY_KEY_OPTIONS,
  API_RELAY_KEYS,
  apiAiDiscoverModels,
  apiAiKeyDetail,
  apiAiKeyTest,
  apiAiModelDetail,
  apiAiModelRouteDetail,
  apiAiModelRoutes,
  apiAiProviderDetail,
  apiAiProviderKeys,
  apiAiProviderModels,
  apiAiProviderModelsBatch,
  apiAiProviderUpstreamAssignment,
  apiAiProviderUpstreams,
  apiAiSyncPricesApply,
  apiAiSyncPricesPreview,
  apiAiUpstreamDetail,
  apiAiUpstreamRecent,
  apiAiUsageRequest,
  apiRelayKeyDetail,
  apiRelayKeyReveal,
  apiRelayKeyRotate,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import {
  aiDailyUsageSchema,
  aiErrorDailySchema,
  aiErrorOverviewSchema,
  aiKeySchema,
  aiModelRouteSchema,
  aiModelSchema,
  aiProviderSchema,
  aiRequestLogSchema,
  aiUpstreamAssignmentSchema,
  aiUpstreamDetailSchema,
  aiUpstreamSchema,
  aiUpstreamsOverviewSchema,
  aiUsageByKeySchema,
  aiUsageRecordSchema,
  aiUsageSummarySchema,
  discoveredModelSchema,
  gatewayConfigSchema,
  gatewayStatusSchema,
  priceDiffSchema,
  relayConsumerKeySchema,
  relayKeyOptionSchema,
  testAiKeyResultSchema,
} from "./schemas";

// ── AI Providers ──────────────────────────────────────────────────────

export function useAiProviders() {
  return useQuery({
    queryKey: queryKeys.aiProviders(),
    queryFn: () => get(API_AI_PROVIDERS, z.array(aiProviderSchema)),
  });
}

// ── Global Upstreams ──────────────────────────────────────────────────

export function useAiUpstreams() {
  return useQuery({
    queryKey: queryKeys.aiUpstreams(),
    queryFn: () => get(API_AI_UPSTREAMS, z.array(aiUpstreamSchema)),
  });
}

export function useCreateAiUpstream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      baseUrl: string;
      kind?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    }) => post(API_AI_UPSTREAMS, body, aiUpstreamSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreams() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
    },
  });
}

export function useUpdateAiUpstream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      name?: string;
      baseUrl?: string;
      kind?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    }) => put(apiAiUpstreamDetail(id), body, aiUpstreamSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreams() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: ["app", "ai-provider-assignments"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetail(vars.id) });
    },
  });
}

export function useDeleteAiUpstream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiAiUpstreamDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreams() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: ["app", "ai-provider-assignments"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderKeysPrefix() });
    },
  });
}

// ── Provider ↔ Upstream Assignments ──────────────────────────────────

export function useAiProviderAssignments(providerId: number) {
  return useQuery({
    queryKey: queryKeys.aiProviderAssignments(providerId),
    queryFn: () => get(apiAiProviderUpstreams(providerId), z.array(aiUpstreamAssignmentSchema)),
    enabled: providerId > 0,
  });
}

export function useAiUpstreamDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.aiUpstreamDetail(id!),
    queryFn: () => get(apiAiUpstreamDetail(id!), aiUpstreamDetailSchema),
    enabled: id != null,
  });
}

export function useAiUpstreamsOverview(hours = 24, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUpstreamsOverview(hours),
    queryFn: () => get(`${API_AI_UPSTREAMS_OVERVIEW}?hours=${hours}`, aiUpstreamsOverviewSchema),
    refetchInterval,
  });
}

export function useAiUpstreamRecent(
  id: number | null,
  limit = 10,
  refetchInterval?: number | false,
) {
  return useQuery({
    queryKey: queryKeys.aiUpstreamRecent(id ?? 0, limit),
    queryFn: () => get(`${apiAiUpstreamRecent(id!)}?limit=${limit}`, z.array(aiUsageRecordSchema)),
    enabled: !!id,
    refetchInterval,
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
  upstreamRoutingStrategy?: string;
  authConfig?: Record<string, unknown>;
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

export function useCreateAiProviderAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      ...body
    }: {
      providerId: number;
      upstreamId: number;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }) => post(apiAiProviderUpstreams(providerId), body, z.unknown()),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderAssignments(vars.providerId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetailPrefix() });
    },
  });
}

export function useUpdateAiProviderAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      assignmentId,
      ...body
    }: {
      providerId: number;
      assignmentId: number;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }) => put(apiAiProviderUpstreamAssignment(providerId, assignmentId), body, z.unknown()),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderAssignments(vars.providerId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetailPrefix() });
    },
  });
}

export function useDeleteAiProviderAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, assignmentId }: { providerId: number; assignmentId: number }) =>
      del(
        apiAiProviderUpstreamAssignment(providerId, assignmentId),
        z.object({ success: z.boolean(), deletedKeys: z.number() }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderAssignments(vars.providerId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetailPrefix() });
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

export function useAiProviderKeys(providerId: number) {
  return useQuery({
    queryKey: queryKeys.aiProviderKeys(providerId),
    queryFn: () => get(apiAiProviderKeys(providerId), z.array(aiKeySchema)),
    enabled: providerId > 0,
  });
}

export function useCreateAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      providerId: number;
      upstreamId?: number | null;
      name: string;
      apiKey: string;
      ownerId?: number | null;
    }) => post(API_AI_KEYS, body, aiKeySchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderKeys(vars.providerId) });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
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
      upstreamId?: number | null;
    }) => put(apiAiKeyDetail(id), body, aiKeySchema),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderKeys(data.providerId) });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useDeleteAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiAiKeyDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useTestAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(apiAiKeyTest(id), {}, testAiKeyResultSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiKeys() });
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderKeysPrefix() });
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
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
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
        z.object({
          created: z.number(),
          linked: z.number().optional(),
          models: z.array(aiModelSchema),
        }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
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
    }: { id: number; providerId?: number | null } & Partial<CreateAiModelBody>) =>
      put(apiAiModelDetail(id), body, aiModelSchema),
    onSuccess: (_data, vars) => {
      if (vars.providerId) {
        qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useDeleteAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, providerId: _pid }: { id: number; providerId?: number | null }) =>
      del(apiAiModelDetail(id), z.object({ success: z.boolean() })),
    onSuccess: (_data, vars) => {
      if (vars.providerId) {
        qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useBatchDeleteAiModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, providerId: _pid }: { ids: number[]; providerId?: number | null }) =>
      post(API_AI_MODELS_BATCH_DELETE, { ids }, z.object({ deleted: z.number() })),
    onSuccess: (_data, vars) => {
      if (vars.providerId) {
        qc.invalidateQueries({ queryKey: queryKeys.aiProviderModels(vars.providerId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useDiscoverModels(providerId: number, source: string = "official") {
  return useQuery({
    queryKey: queryKeys.aiDiscoverModels(providerId, source),
    queryFn: () => get(apiAiDiscoverModels(providerId, source), z.array(discoveredModelSchema)),
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
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

// ── AI Models (flat list with routes) ─────────────────────────────────

export function useAiModelsList() {
  return useQuery({
    queryKey: queryKeys.aiModels(),
    queryFn: () => get(API_AI_MODELS, z.array(aiModelSchema)),
  });
}

// ── AI Model Routes ──────────────────────────────────────────────────

export function useAiModelRoutes(modelId: number) {
  return useQuery({
    queryKey: queryKeys.aiModelRoutes(modelId),
    queryFn: () => get(apiAiModelRoutes(modelId), z.array(aiModelRouteSchema)),
    enabled: modelId > 0,
  });
}

export function useCreateAiModelRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      ...body
    }: {
      modelId: number;
      providerId: number;
      providerModelId?: string;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }) => post(apiAiModelRoutes(modelId), body, aiModelRouteSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiModelRoutes(vars.modelId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useUpdateAiModelRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      routeId,
      ...body
    }: {
      modelId: number;
      routeId: number;
      providerModelId?: string | null;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }) => put(apiAiModelRouteDetail(modelId, routeId), body, aiModelRouteSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiModelRoutes(vars.modelId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useDeleteAiModelRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, routeId }: { modelId: number; routeId: number }) =>
      del(apiAiModelRouteDetail(modelId, routeId), z.object({ success: z.boolean() })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiModelRoutes(vars.modelId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
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

export function useAiErrorOverview(days = 30, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiErrorOverview(days),
    queryFn: () => get(`${API_AI_ERROR_OVERVIEW}?days=${days}`, aiErrorOverviewSchema),
    refetchInterval,
  });
}

export function useAiErrorDaily(days = 30, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiErrorDaily(days),
    queryFn: () => get(`${API_AI_ERROR_DAILY}?days=${days}`, z.array(aiErrorDailySchema)),
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

// ── AI Usage by User ─────────────────────────────────────────────────

export function useAiUsageSummaryByUser(userId: number, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageSummaryByUser(userId),
    queryFn: () => get(`${API_AI_USAGE_SUMMARY}?userId=${userId}`, aiUsageSummarySchema),
    refetchInterval,
    enabled: userId > 0,
  });
}

export function useAiUsageRecentByUser(userId: number, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiUsageRecentByUser(userId),
    queryFn: () => get(`${API_AI_USAGE_RECENT}?userId=${userId}`, z.array(aiUsageRecordSchema)),
    refetchInterval,
    enabled: userId > 0,
  });
}

export function useAiUsageDailyByUser(userId: number, days = 30) {
  return useQuery({
    queryKey: queryKeys.aiUsageDailyByUser(userId, days),
    queryFn: () =>
      get(`${API_AI_USAGE_DAILY}?userId=${userId}&days=${days}`, z.array(aiDailyUsageSchema)),
    enabled: userId > 0,
  });
}

export function useAiUsageByKeyForUser(userId: number) {
  return useQuery({
    queryKey: queryKeys.aiUsageByKeyForUser(userId),
    queryFn: () => get(`${API_AI_USAGE_BY_KEY}?userId=${userId}`, z.array(aiUsageByKeySchema)),
    enabled: userId > 0,
  });
}

export function useAiLogs(opts?: {
  consumerKeyId?: number;
  modelId?: string;
  providerId?: string;
  statusClass?: "4xx" | "5xx";
  page?: number;
  refetchInterval?: number | false;
}) {
  const page = opts?.page ?? 0;
  const params = new URLSearchParams();
  if (opts?.consumerKeyId != null) params.set("consumerKeyId", String(opts.consumerKeyId));
  if (opts?.modelId) params.set("modelId", opts.modelId);
  if (opts?.providerId) params.set("providerId", opts.providerId);
  if (opts?.statusClass) params.set("statusClass", opts.statusClass);
  params.set("limit", String(DEFAULT_PAGE_SIZE));
  params.set("offset", String(page * DEFAULT_PAGE_SIZE));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.aiLogs({
      consumerKeyId: opts?.consumerKeyId,
      modelId: opts?.modelId,
      providerId: opts?.providerId,
      statusClass: opts?.statusClass,
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

/** Paginated list with filters — for the consumer-keys admin table. */
export function useRelayKeyList(params?: { prefix?: string; userUuid?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (params?.prefix) qs.set("prefix", params.prefix);
  if (params?.userUuid) qs.set("userUuid", params.userUuid);
  if (params?.page) qs.set("page", String(params.page));
  qs.set("limit", String(DEFAULT_PAGE_SIZE));
  const url = `${API_RELAY_KEYS}?${qs}`;

  return useQuery({
    queryKey: queryKeys.relayKeys(params),
    queryFn: () => get(url, z.array(relayConsumerKeySchema)),
  });
}

/** Lightweight full list — for name lookups in usage/logs pages. */
export function useRelayKeyOptions() {
  return useQuery({
    queryKey: queryKeys.relayKeyOptions(),
    queryFn: () => get(API_RELAY_KEY_OPTIONS, z.array(relayKeyOptionSchema)),
    staleTime: 60_000,
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
      qc.invalidateQueries({ queryKey: queryKeys.relayKeysAll() });
      qc.invalidateQueries({ queryKey: queryKeys.relayKeyOptions() });
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
      qc.invalidateQueries({ queryKey: queryKeys.relayKeysAll() });
      qc.invalidateQueries({ queryKey: queryKeys.relayKeyOptions() });
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
      qc.invalidateQueries({ queryKey: queryKeys.relayKeysAll() });
      qc.invalidateQueries({ queryKey: queryKeys.relayKeyOptions() });
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
      qc.invalidateQueries({ queryKey: queryKeys.relayKeysAll() });
      qc.invalidateQueries({ queryKey: queryKeys.relayKeyOptions() });
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
