import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { GatewayConfig } from "./ai-schemas";
import { del, get, post, put } from "./client";
import {
  API_ADMIN_GATEWAY_CONFIG,
  API_ADMIN_GATEWAY_STATUS,
  API_AI_CREDENTIALS,
  API_AI_DEFAULT_MARKUP,
  API_AI_ENDPOINT_CREDENTIALS,
  API_AI_ENDPOINTS,
  API_AI_ENDPOINTS_OVERVIEW,
  API_AI_ERROR_DAILY,
  API_AI_ERROR_OVERVIEW,
  API_AI_MODELS,
  API_AI_MODELS_BATCH_DELETE,
  API_AI_REQUEST_LOGGING,
  API_AI_SUPPLIERS,
  API_AI_UPSTREAMS,
  API_AI_UPSTREAMS_OVERVIEW,
  API_AI_USAGE_BY_KEY,
  API_AI_USAGE_DAILY,
  API_AI_USAGE_RECENT,
  API_AI_USAGE_SUMMARY,
  API_RELAY_KEY_OPTIONS,
  API_RELAY_KEYS,
  apiAiDiscoverModels,
  apiAiEndpointCredentialDetail,
  apiAiEndpointCredentials,
  apiAiEndpointCredentialTest,
  apiAiEndpointDetail,
  apiAiEndpointModels,
  apiAiEndpointModelsBatch,
  apiAiEndpointUpstreamAssignment,
  apiAiEndpointUpstreams,
  apiAiModelDetail,
  apiAiModelRouteDetail,
  apiAiModelRoutes,
  apiAiSupplierDetail,
  apiAiSyncPricesApply,
  apiAiSyncPricesPreview,
  apiAiUpstreamDetail,
  apiAiUpstreamHourly,
  apiAiUpstreamModelMapping,
  apiAiUpstreamModelMappings,
  apiAiUpstreamRecent,
  apiAiUsageRequest,
  apiRelayKeyDetail,
  apiRelayKeyReveal,
  apiRelayKeyRotate,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import {
  aiCredentialSchema,
  aiDailyUsageSchema,
  aiEndpointCredentialSchema,
  aiEndpointSchema,
  aiEndpointsOverviewSchema,
  aiErrorDailySchema,
  aiErrorOverviewSchema,
  aiModelRouteSchema,
  aiModelSchema,
  aiRequestLogSchema,
  aiSupplierSchema,
  aiUpstreamAssignmentSchema,
  aiUpstreamDetailSchema,
  aiUpstreamHourlyRowSchema,
  aiUpstreamModelMappingSchema,
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
  testAiEndpointCredentialResultSchema,
} from "./schemas";

const paginatedAiUsageRecordsSchema = z.object({
  items: z.array(aiUsageRecordSchema),
  total: z.number(),
});
const paginatedRelayConsumerKeysSchema = z.object({
  items: z.array(relayConsumerKeySchema),
  total: z.number(),
});

// ── AI Suppliers / Endpoints ──────────────────────────────────────────

export function useAiSuppliers() {
  return useQuery({
    queryKey: queryKeys.aiSuppliers(),
    queryFn: () => get(API_AI_SUPPLIERS, z.array(aiSupplierSchema)),
  });
}

export function useAiEndpoints() {
  return useQuery({
    queryKey: queryKeys.aiEndpoints(),
    queryFn: () => get(API_AI_ENDPOINTS, z.array(aiEndpointSchema)),
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
      modelsEndpoint?: string | null;
      concurrencyLimit?: number | null;
      queueTimeoutMs?: number;
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
      modelsEndpoint?: string | null;
      concurrencyLimit?: number | null;
      queueTimeoutMs?: number;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    }) => put(apiAiUpstreamDetail(id), body, aiUpstreamSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreams() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: ["app", "ai-endpoint-assignments"] });
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
      qc.invalidateQueries({ queryKey: ["app", "ai-endpoint-assignments"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointsOverview(24) });
      qc.invalidateQueries({ queryKey: queryKeys.aiCredentials() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
    },
  });
}

// ── Upstream Model Mappings ──────────────────────────────────────────

export function useAiUpstreamModelMappings(upstreamId: number | null) {
  return useQuery({
    queryKey: queryKeys.aiUpstreamModelMappings(upstreamId!),
    queryFn: () =>
      get(apiAiUpstreamModelMappings(upstreamId!), z.array(aiUpstreamModelMappingSchema)),
    enabled: upstreamId != null,
  });
}

export function useCreateModelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      upstreamId: number;
      sourceModelId: string;
      mappedModelId: string;
      enabled?: boolean;
    }) => {
      const { upstreamId, ...rest } = body;
      return post(apiAiUpstreamModelMappings(upstreamId), rest, aiUpstreamModelMappingSchema);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamModelMappings(vars.upstreamId) });
    },
  });
}

export function useUpdateModelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      upstreamId: number;
      mappingId: number;
      mappedModelId?: string;
      enabled?: boolean;
    }) => {
      const { upstreamId, mappingId, ...rest } = body;
      return put(
        apiAiUpstreamModelMapping(upstreamId, mappingId),
        rest,
        aiUpstreamModelMappingSchema,
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamModelMappings(vars.upstreamId) });
    },
  });
}

export function useDeleteModelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { upstreamId: number; mappingId: number }) =>
      del(
        apiAiUpstreamModelMapping(body.upstreamId, body.mappingId),
        z.object({ success: z.boolean() }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamModelMappings(vars.upstreamId) });
    },
  });
}

// ── Endpoint ↔ Upstream Assignments ──────────────────────────────────

export function useAiEndpointAssignments(endpointId: number) {
  return useQuery({
    queryKey: queryKeys.aiEndpointAssignments(endpointId),
    queryFn: () => get(apiAiEndpointUpstreams(endpointId), z.array(aiUpstreamAssignmentSchema)),
    enabled: endpointId > 0,
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

export function useAiEndpointsOverview(hours = 24, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.aiEndpointsOverview(hours),
    queryFn: () => get(`${API_AI_ENDPOINTS_OVERVIEW}?hours=${hours}`, aiEndpointsOverviewSchema),
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

export function useAiUpstreamHourly(
  id: number | null,
  hours = 24,
  refetchInterval?: number | false,
) {
  return useQuery({
    queryKey: queryKeys.aiUpstreamHourly(id ?? 0, hours),
    queryFn: () =>
      get(`${apiAiUpstreamHourly(id!)}?hours=${hours}`, z.array(aiUpstreamHourlyRowSchema)),
    enabled: !!id,
    refetchInterval,
  });
}

interface CreateAiSupplierBody {
  supplierId: string;
  name: string;
  iconUrl?: string;
  enabled?: boolean;
}

export function useCreateAiSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAiSupplierBody) => post(API_AI_SUPPLIERS, body, aiSupplierSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiSuppliers() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
    },
  });
}

export function useUpdateAiSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<CreateAiSupplierBody>) =>
      put(apiAiSupplierDetail(id), body, aiSupplierSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiSuppliers() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
    },
  });
}

export function useDeleteAiSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiAiSupplierDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiSuppliers() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
    },
  });
}

interface CreateAiEndpointBody {
  supplierId: number;
  endpointId: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  enabled?: boolean;
  upstreamRoutingStrategy?: string;
  officialConcurrencyLimit?: number | null;
  officialQueueTimeoutMs?: number;
  authConfig?: Record<string, unknown>;
}

type UpdateAiEndpointBody = Partial<CreateAiEndpointBody> & {
  loadBalanceStrategy?: string;
};

export function useCreateAiEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAiEndpointBody) => post(API_AI_ENDPOINTS, body, aiEndpointSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointsOverview(24) });
    },
  });
}

export function useUpdateAiEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & UpdateAiEndpointBody) =>
      put(apiAiEndpointDetail(id), body, aiEndpointSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointsOverview(24) });
    },
  });
}

export function useDeleteAiEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiAiEndpointDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
    },
  });
}

export function useCreateAiEndpointAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      endpointId,
      ...body
    }: {
      endpointId: number;
      upstreamId: number;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }) => post(apiAiEndpointUpstreams(endpointId), body, z.unknown()),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointAssignments(vars.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointsOverview(24) });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetailPrefix() });
    },
  });
}

export function useUpdateAiEndpointAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      endpointId,
      assignmentId,
      ...body
    }: {
      endpointId: number;
      assignmentId: number;
      priority?: number;
      weight?: number;
      enabled?: boolean;
    }) => put(apiAiEndpointUpstreamAssignment(endpointId, assignmentId), body, z.unknown()),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointAssignments(vars.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpoints() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointsOverview(24) });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetailPrefix() });
    },
  });
}

export function useDeleteAiEndpointAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ endpointId, assignmentId }: { endpointId: number; assignmentId: number }) =>
      del(
        apiAiEndpointUpstreamAssignment(endpointId, assignmentId),
        z.object({ success: z.boolean() }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointAssignments(vars.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointsOverview(24) });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
      qc.invalidateQueries({ queryKey: ["app", "ai-upstreams-overview"] });
      qc.invalidateQueries({ queryKey: queryKeys.aiUpstreamDetailPrefix() });
    },
  });
}

// ── AI Credentials ────────────────────────────────────────────────────

export function useAiCredentials() {
  return useQuery({
    queryKey: queryKeys.aiCredentials(),
    queryFn: () => get(API_AI_CREDENTIALS, z.array(aiCredentialSchema)),
  });
}

export function useAiEndpointCredentials(endpointId: number) {
  return useQuery({
    queryKey: queryKeys.aiEndpointCredentials(endpointId),
    queryFn: () => get(apiAiEndpointCredentials(endpointId), z.array(aiEndpointCredentialSchema)),
    enabled: endpointId > 0,
  });
}

export function useCreateAiEndpointCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      endpointId: number;
      supplierId: number;
      upstreamId?: number | null;
      name: string;
      apiKey: string;
      ownerId?: number | null;
      weight?: number;
      enabled?: boolean;
    }) => {
      const credential = await post(
        API_AI_CREDENTIALS,
        {
          supplierId: body.supplierId,
          name: body.name,
          apiKey: body.apiKey,
          ownerId: body.ownerId,
        },
        aiCredentialSchema,
      );
      return post(
        API_AI_ENDPOINT_CREDENTIALS,
        {
          endpointId: body.endpointId,
          credentialId: credential.id,
          upstreamId: body.upstreamId,
          name: body.name,
          weight: body.weight,
          enabled: body.enabled,
        },
        aiEndpointCredentialSchema,
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiCredentials() });
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentials(vars.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useUpdateAiEndpointCredential() {
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
      upstreamId?: number | null;
    }) => put(apiAiEndpointCredentialDetail(id), body, aiEndpointCredentialSchema),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentials(data.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiCredentials() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useDeleteAiEndpointCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      del(apiAiEndpointCredentialDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.aiCredentials() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useTestAiEndpointCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      post(apiAiEndpointCredentialTest(id), {}, testAiEndpointCredentialResultSchema),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointCredentialsPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.aiCredentials() });
    },
  });
}

// ── AI Models ─────────────────────────────────────────────────────────

export function useAiModels(endpointId: number) {
  return useQuery({
    queryKey: queryKeys.aiEndpointModels(endpointId),
    queryFn: () => get(apiAiEndpointModels(endpointId), z.array(aiModelSchema)),
    enabled: endpointId > 0,
  });
}

interface CreateAiModelBody {
  clientFormat?: "openai" | "anthropic";
  modelId: string;
  name: string;
  contextWindow?: number | null;
  inputPrice: string;
  outputPrice: string;
  capabilities: string[];
  limitedFreeUntil?: string | null;
  grayReleaseEnabled?: boolean;
  grayUserIds?: number[];
  enabled?: boolean;
}

export function useCreateAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ endpointId, ...body }: { endpointId: number } & CreateAiModelBody) =>
      post(apiAiEndpointModels(endpointId), body, aiModelSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointModels(vars.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useBatchCreateAiModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      endpointId,
      models,
    }: {
      endpointId: number;
      models: Array<{
        clientFormat?: "openai" | "anthropic";
        modelId: string;
        name: string;
        inputPrice?: string;
        outputPrice?: string;
        capabilities?: string[];
        limitedFreeUntil?: string | null;
        grayReleaseEnabled?: boolean;
        enabled?: boolean;
      }>;
    }) =>
      post(
        apiAiEndpointModelsBatch(endpointId),
        { models },
        z.object({
          created: z.number(),
          linked: z.number().optional(),
          models: z.array(aiModelSchema),
        }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointModels(vars.endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useUpdateAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      endpointId: _endpointId,
      ...body
    }: { id: number; endpointId?: number | null } & Partial<CreateAiModelBody>) =>
      put(apiAiModelDetail(id), body, aiModelSchema),
    onSuccess: (_data, vars) => {
      if (vars.endpointId) {
        qc.invalidateQueries({ queryKey: queryKeys.aiEndpointModels(vars.endpointId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useDeleteAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, endpointId: _endpointId }: { id: number; endpointId?: number | null }) =>
      del(apiAiModelDetail(id), z.object({ success: z.boolean() })),
    onSuccess: (_data, vars) => {
      if (vars.endpointId) {
        qc.invalidateQueries({ queryKey: queryKeys.aiEndpointModels(vars.endpointId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useBatchDeleteAiModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, endpointId: _endpointId }: { ids: number[]; endpointId?: number | null }) =>
      post(API_AI_MODELS_BATCH_DELETE, { ids }, z.object({ deleted: z.number() })),
    onSuccess: (_data, vars) => {
      if (vars.endpointId) {
        qc.invalidateQueries({ queryKey: queryKeys.aiEndpointModels(vars.endpointId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.aiModels() });
    },
  });
}

export function useDiscoverModels(
  endpointId: number,
  source: string = "official",
  clientFormat?: "openai" | "anthropic",
) {
  return useQuery({
    queryKey: queryKeys.aiDiscoverModels(endpointId, source, clientFormat),
    queryFn: () =>
      get(apiAiDiscoverModels(endpointId, source, clientFormat), z.array(discoveredModelSchema)),
    enabled: false,
  });
}

export function usePreviewSyncPrices() {
  return useMutation({
    mutationFn: ({ endpointId }: { endpointId: number }) =>
      post(apiAiSyncPricesPreview(endpointId), {}, z.array(priceDiffSchema)),
  });
}

export function useApplySyncPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ endpointId, modelIds }: { endpointId: number; modelIds: number[] }) =>
      post(apiAiSyncPricesApply(endpointId), { modelIds }, z.object({ synced: z.number() })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiEndpointModels(vars.endpointId) });
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
      endpointId: number;
      endpointModelId?: string;
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
      endpointModelId?: string | null;
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
    queryFn: async () => (await get(API_AI_USAGE_RECENT, paginatedAiUsageRecordsSchema)).items,
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
      get(`${API_AI_USAGE_RECENT}?consumerKeyId=${keyId}`, paginatedAiUsageRecordsSchema).then(
        (data) => data.items,
      ),
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
    queryFn: () =>
      get(`${API_AI_USAGE_RECENT}?userId=${userId}`, paginatedAiUsageRecordsSchema).then(
        (data) => data.items,
      ),
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
  endpointId?: string;
  statusClass?: "4xx" | "5xx";
  requestId?: string;
  page?: number;
  refetchInterval?: number | false;
}) {
  const page = opts?.page ?? 0;
  const params = new URLSearchParams();
  if (opts?.consumerKeyId != null) params.set("consumerKeyId", String(opts.consumerKeyId));
  if (opts?.modelId) params.set("modelId", opts.modelId);
  if (opts?.endpointId) params.set("endpointId", opts.endpointId);
  if (opts?.statusClass) params.set("statusClass", opts.statusClass);
  if (opts?.requestId) params.set("requestId", opts.requestId);
  params.set("limit", String(DEFAULT_PAGE_SIZE));
  params.set("offset", String(page * DEFAULT_PAGE_SIZE));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.aiLogs({
      consumerKeyId: opts?.consumerKeyId,
      modelId: opts?.modelId,
      endpointId: opts?.endpointId,
      statusClass: opts?.statusClass,
      requestId: opts?.requestId,
      page,
    }),
    queryFn: () => get(`${API_AI_USAGE_RECENT}?${qs}`, paginatedAiUsageRecordsSchema),
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
    queryFn: () => get(url, paginatedRelayConsumerKeysSchema),
    placeholderData: keepPreviousData,
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
