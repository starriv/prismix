import { z } from "zod";

const healthCheckStatusSchema = z.enum(["unknown", "healthy", "degraded", "down"]);
const nullableDateSchema = z.string().or(z.number()).nullable().optional();
const connectorConfigModeSchema = z.enum(["inherit", "override"]);
const effectiveRuntimeConfigSchema = z.object({
  authMode: connectorConfigModeSchema,
  authType: z.string(),
  authConfig: z.record(z.string(), z.unknown()),
  concurrencyMode: connectorConfigModeSchema,
  officialConcurrencyLimit: z.number().nullable().optional(),
  officialQueueTimeoutMs: z.number().optional().default(30_000),
});

// ── AI Suppliers / Endpoints ────────────────────────────────────

export const aiSupplierSchema = z.object({
  id: z.number(),
  supplierId: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable().optional(),
  authType: z.string().optional().default("bearer"),
  authConfig: z.record(z.string(), z.unknown()).optional().default({}),
  officialConcurrencyLimit: z.number().nullable().optional(),
  officialQueueTimeoutMs: z.number().optional().default(30_000),
  enabled: z.coerce.boolean(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiSupplier = z.infer<typeof aiSupplierSchema>;

export const aiEndpointSchema = z.object({
  id: z.number(),
  supplierId: z.number(),
  supplierSlug: z.string().optional(),
  supplierName: z.string().optional(),
  name: z.string(),
  endpointId: z.string(),
  baseUrl: z.string(),
  apiFormat: z.string(),
  authMode: connectorConfigModeSchema.optional().default("inherit"),
  authType: z.string(),
  authConfig: z.record(z.string(), z.unknown()),
  enabled: z.coerce.boolean(),
  loadBalanceStrategy: z.string().optional().default("round-robin"),
  upstreamRoutingStrategy: z.string().optional().default("priority"),
  concurrencyMode: connectorConfigModeSchema.optional().default("inherit"),
  officialConcurrencyLimit: z.number().nullable().optional(),
  officialQueueTimeoutMs: z.number().optional().default(30_000),
  effectiveRuntimeConfig: effectiveRuntimeConfigSchema.optional(),
  iconUrl: z.string().nullable().optional(),
  healthStatus: healthCheckStatusSchema.optional().default("unknown"),
  lastCheckedAt: nullableDateSchema,
  lastSuccessAt: nullableDateSchema,
  lastFailureAt: nullableDateSchema,
  lastError: z.string().nullable().optional(),
  consecutiveFailures: z.number().optional().default(0),
  autoDisabled: z.coerce.boolean().optional().default(false),
  upstreamCount: z.number().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiEndpoint = z.infer<typeof aiEndpointSchema>;

// ── AI Upstreams (global) ──────────────────────────────────────

export const aiUpstreamSchema = z.object({
  id: z.number(),
  upstreamId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  kind: z.string(),
  modelsEndpoint: z.string().nullable().optional(),
  concurrencyLimit: z.number().nullable().optional(),
  queueTimeoutMs: z.number().optional().default(30_000),
  enabled: z.coerce.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  healthStatus: healthCheckStatusSchema.optional().default("unknown"),
  lastCheckedAt: nullableDateSchema,
  lastSuccessAt: nullableDateSchema,
  lastFailureAt: nullableDateSchema,
  lastError: z.string().nullable().optional(),
  consecutiveFailures: z.number().optional().default(0),
  autoDisabled: z.coerce.boolean().optional().default(false),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiUpstream = z.infer<typeof aiUpstreamSchema>;

export const aiUpstreamAssignmentSchema = z.object({
  id: z.number(),
  endpointId: z.number(),
  upstream: aiUpstreamSchema,
  priority: z.number(),
  weight: z.number(),
  enabled: z.coerce.boolean(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiUpstreamAssignment = z.infer<typeof aiUpstreamAssignmentSchema>;

export const aiUpstreamOverviewItemSchema = z.object({
  id: z.number(),
  upstreamId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  kind: z.string(),
  modelsEndpoint: z.string().nullable().optional(),
  concurrencyLimit: z.number().nullable().optional(),
  queueTimeoutMs: z.number().optional().default(30_000),
  enabled: z.coerce.boolean(),
  autoDisabled: z.coerce.boolean().optional().default(false),
  assignmentCount: z.number(),
  totalCredentials: z.number(),
  enabledCredentials: z.number(),
  requests24h: z.number(),
  clientErrors24h: z.number(),
  serverErrors24h: z.number(),
  totalTokens24h: z.number(),
  avgLatencyMs24h: z.number(),
  errorRate24h: z.number(),
  lastSeenAt: z.string().nullable(),
  lastStatusCode: z.number().nullable(),
  lastError: z.string().nullable(),
  healthStatus: z.enum(["unknown", "healthy", "degraded", "down", "idle", "no-key", "disabled"]),
  lastCheckedAt: nullableDateSchema,
  consecutiveFailures: z.number().optional().default(0),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiUpstreamOverviewItem = z.infer<typeof aiUpstreamOverviewItemSchema>;

export const aiUpstreamsOverviewSchema = z.object({
  totals: z.object({
    totalUpstreams: z.number(),
    enabledUpstreams: z.number(),
    activeUpstreams24h: z.number(),
    degradedUpstreams30m: z.number(),
  }),
  upstreams: z.array(aiUpstreamOverviewItemSchema),
});
export type AiUpstreamsOverview = z.infer<typeof aiUpstreamsOverviewSchema>;

// ── AI Endpoints Overview (health + usage aggregation) ─────────

export const aiEndpointOverviewItemSchema = z.object({
  id: z.number(),
  supplierId: z.number(),
  supplierSlug: z.string(),
  supplierName: z.string(),
  endpointId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  apiFormat: z.string(),
  authMode: connectorConfigModeSchema.optional().default("inherit"),
  authType: z.string(),
  iconUrl: z.string().nullable().optional(),
  concurrencyMode: connectorConfigModeSchema.optional().default("inherit"),
  officialConcurrencyLimit: z.number().nullable().optional(),
  officialQueueTimeoutMs: z.number().optional().default(30_000),
  enabled: z.coerce.boolean(),
  autoDisabled: z.coerce.boolean().optional().default(false),
  upstreamCount: z.number(),
  totalCredentials: z.number(),
  enabledCredentials: z.number(),
  requests24h: z.number(),
  clientErrors24h: z.number(),
  serverErrors24h: z.number(),
  totalTokens24h: z.number(),
  avgLatencyMs24h: z.number(),
  errorRate24h: z.number(),
  lastSeenAt: z.string().nullable(),
  healthStatus: z.enum(["unknown", "healthy", "degraded", "down", "idle", "no-key", "disabled"]),
  lastCheckedAt: nullableDateSchema,
  lastError: z.string().nullable().optional(),
  consecutiveFailures: z.number().optional().default(0),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiEndpointOverviewItem = z.infer<typeof aiEndpointOverviewItemSchema>;

export const aiEndpointsOverviewSchema = z.object({
  totals: z.object({
    totalEndpoints: z.number(),
    enabledEndpoints: z.number(),
    activeEndpoints24h: z.number(),
    degradedEndpoints30m: z.number(),
  }),
  endpoints: z.array(aiEndpointOverviewItemSchema),
});
export type AiEndpointsOverview = z.infer<typeof aiEndpointsOverviewSchema>;

// ── AI Upstream Hourly (time-series for chart) ─────────────────

export const aiUpstreamHourlyRowSchema = z.object({
  hour: z.string(),
  requests: z.number(),
  clientErrors: z.number(),
  serverErrors: z.number(),
  avgLatencyMs: z.number(),
});
export type AiUpstreamHourlyRow = z.infer<typeof aiUpstreamHourlyRowSchema>;

// ── AI Upstream Detail (single upstream + endpoint assignments) ───

export const aiUpstreamDetailAssignmentSchema = z.object({
  id: z.number(),
  endpointId: z.number(),
  endpointName: z.string(),
  endpointSlug: z.string().nullable(),
  priority: z.number(),
  weight: z.number(),
  enabled: z.coerce.boolean(),
});
export type AiUpstreamDetailAssignment = z.infer<typeof aiUpstreamDetailAssignmentSchema>;

export const aiUpstreamModelMappingSchema = z.object({
  id: z.number(),
  upstreamId: z.number(),
  sourceModelId: z.string(),
  mappedModelId: z.string(),
  enabled: z.coerce.boolean(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiUpstreamModelMapping = z.infer<typeof aiUpstreamModelMappingSchema>;

export const aiUpstreamDetailSchema = aiUpstreamSchema.extend({
  assignments: z.array(aiUpstreamDetailAssignmentSchema),
});
export type AiUpstreamDetail = z.infer<typeof aiUpstreamDetailSchema>;

export const aiModelRouteSchema = z.object({
  id: z.number(),
  endpointId: z.number(),
  endpointName: z.string().optional(),
  endpointSlug: z.string().optional(),
  endpointIconUrl: z.string().nullable().optional(),
  supplierName: z.string().optional(),
  supplierSlug: z.string().optional(),
  apiFormat: z.string().optional(),
  endpointModelId: z.string().nullable().optional(),
  priority: z.number(),
  weight: z.number(),
  enabled: z.coerce.boolean(),
  createdAt: z.string().or(z.number()).optional(),
  updatedAt: z.string().or(z.number()).optional(),
});
export type AiModelRoute = z.infer<typeof aiModelRouteSchema>;

export const aiModelGrayUserSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  status: z.number(),
});
export type AiModelGrayUser = z.infer<typeof aiModelGrayUserSchema>;

export const aiModelSchema = z.object({
  id: z.number(),
  modelId: z.string(),
  name: z.string(),
  contextWindow: z.number().nullable().optional(),
  inputPrice: z.string(),
  outputPrice: z.string(),
  capabilities: z.array(z.string()),
  limitedFreeUntil: z.string().nullable().optional(),
  isLimitedFree: z.coerce.boolean().optional(),
  grayReleaseEnabled: z.coerce.boolean().default(false),
  grayUserIds: z.array(z.number()).optional().default([]),
  grayUsers: z.array(aiModelGrayUserSchema).optional().default([]),
  enabled: z.coerce.boolean(),
  routes: z.array(aiModelRouteSchema).optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiModel = z.infer<typeof aiModelSchema>;

// ── AI Credentials ──────────────────────────────────────────────

export const aiCredentialSchema = z.object({
  id: z.number(),
  supplierId: z.number().nullable(),
  ownerId: z.number().nullable().optional(),
  name: z.string(),
  keyPrefix: z.string(),
  enabled: z.coerce.boolean(),
  supplierName: z.string().optional(),
  ownerName: z.string().nullable().optional(),
  lastUsedAt: z.string().or(z.number()).nullable().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiCredential = z.infer<typeof aiCredentialSchema>;

export const aiEndpointCredentialSchema = z.object({
  id: z.number(),
  endpointId: z.number(),
  credentialId: z.number(),
  upstreamId: z.number().nullable().optional(),
  ownerId: z.number().nullable().optional(),
  name: z.string(),
  credentialName: z.string().optional(),
  keyPrefix: z.string(),
  weight: z.number().optional().default(1),
  enabled: z.coerce.boolean(),
  endpointName: z.string().optional(),
  ownerName: z.string().nullable().optional(),
  upstreamName: z.string().nullable().optional(),
  upstreamSlug: z.string().nullable().optional(),
  lastUsedAt: z.string().or(z.number()).nullable().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiEndpointCredential = z.infer<typeof aiEndpointCredentialSchema>;

export const testAiEndpointCredentialResultSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number().optional(),
  status: z.number().optional(),
  error: z.string().optional(),
});
export type TestAiEndpointCredentialResult = z.infer<typeof testAiEndpointCredentialResultSchema>;

// ── AI Usage ────────────────────────────────────────────────────────

const aiUsageBreakdownSchema = z.object({
  endpointId: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.number(),
});

export const aiUsageSummarySchema = z.object({
  totalRequests: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalTokens: z.number(),
  totalEstimatedCost: z.number(),
  errorCount: z.number(),
  errorRate: z.number(),
  cacheHits: z.number().optional().default(0),
  cacheMisses: z.number().optional().default(0),
  cacheBypasses: z.number().optional().default(0),
  cacheEligibleRequests: z.number().optional().default(0),
  cacheHitRate: z.number().optional().default(0),
  promptCacheCreationInputTokens: z.number().optional().default(0),
  promptCacheReadInputTokens: z.number().optional().default(0),
  promptCacheCreationRate: z.number().optional().default(0),
  promptCacheReadRate: z.number().optional().default(0),
  avgLatencyMs: z.number().optional().default(0),
  p95LatencyMs: z.number().optional().default(0),
  avgUpstreamTtfbMs: z.number().optional().default(0),
  p95UpstreamTtfbMs: z.number().optional().default(0),
  avgTokensPerSecond: z.number().optional().default(0),
  p95TokensPerSecond: z.number().optional().default(0),
  byEndpoint: z.array(aiUsageBreakdownSchema),
  byModel: z.array(aiUsageBreakdownSchema.extend({ modelId: z.string() })),
});
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;

export const aiDailyUsageSchema = z.object({
  date: z.string(),
  requests: z.coerce.number(),
  totalTokens: z.coerce.number(),
  estimatedCost: z.coerce.number(),
});
export type AiDailyUsage = z.infer<typeof aiDailyUsageSchema>;

export const aiErrorOverviewSchema = z.object({
  total4xx: z.number(),
  total5xx: z.number(),
  last24h4xx: z.number(),
  last24h5xx: z.number(),
  peak4xx: z.number(),
  peak4xxDate: z.string().nullable(),
  peak5xx: z.number(),
  peak5xxDate: z.string().nullable(),
});
export type AiErrorOverview = z.infer<typeof aiErrorOverviewSchema>;

export const aiErrorDailySchema = z.object({
  date: z.string(),
  clientErrors: z.coerce.number(),
  serverErrors: z.coerce.number(),
  totalErrors: z.coerce.number(),
});
export type AiErrorDaily = z.infer<typeof aiErrorDailySchema>;

export const aiUsageRecordSchema = z.object({
  id: z.number(),
  endpointCredentialId: z.number().nullable(),
  credentialId: z.number().nullable().optional(),
  credentialOwnerId: z.number().nullable().optional(),
  consumerKeyId: z.number().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  endpointId: z.string().nullable(),
  modelId: z.string().nullable(),
  upstreamId: z.number().nullable().optional(),
  upstreamName: z.string().nullable().optional(),
  upstreamBaseUrl: z.string().nullable().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.string().nullable(),
  upstreamCost: z.string().nullable().optional(),
  markupPercent: z.number().nullable().optional(),
  latencyMs: z.number().nullable(),
  routeType: z.string().nullable().optional(),
  isStream: z.boolean().nullable().optional(),
  cacheStatus: z.string().nullable().optional(),
  cacheLookupMs: z.number().nullable().optional(),
  cacheWriteMs: z.number().nullable().optional(),
  routingMs: z.number().nullable().optional(),
  queueWaitMs: z.number().nullable().optional(),
  upstreamTtfbMs: z.number().nullable().optional(),
  upstreamBodyMs: z.number().nullable().optional(),
  transformMs: z.number().nullable().optional(),
  billingMs: z.number().nullable().optional(),
  firstChunkMs: z.number().nullable().optional(),
  firstTokenMs: z.number().nullable().optional(),
  tokensPerSecond: z.number().nullable().optional(),
  requestBytes: z.number().nullable().optional(),
  responseBytes: z.number().nullable().optional(),
  streamChunks: z.number().nullable().optional(),
  streamBytes: z.number().nullable().optional(),
  streamPingCount: z.number().nullable().optional(),
  streamAbortReason: z.string().nullable().optional(),
  attemptCount: z.number().nullable().optional(),
  retryCount: z.number().nullable().optional(),
  cacheCreationInputTokens: z.number().nullable().optional(),
  cacheReadInputTokens: z.number().nullable().optional(),
  reasoningTokens: z.number().nullable().optional(),
  statusCode: z.number().nullable(),
  requestId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type AiUsageRecord = z.infer<typeof aiUsageRecordSchema>;

export const aiRequestLogSchema = z.object({
  requestId: z.string(),
  consumerKeyId: z.number().nullable(),
  modelId: z.string(),
  requestBody: z.string(),
  responseBody: z.string(),
  createdAt: z.string(),
});
export type AiRequestLog = z.infer<typeof aiRequestLogSchema>;

export const aiUsageByKeySchema = z.object({
  consumerKeyId: z.number(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.number(),
});
export type AiUsageByKey = z.infer<typeof aiUsageByKeySchema>;

// ── Relay Consumer Keys ─────────────────────────────────────────────

export const relayConsumerKeySchema = z.object({
  id: z.number(),
  userId: z.number().nullable(),
  userUuid: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  agentId: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  apiKeyPrefix: z.string(),
  apiKey: z.string().optional(), // only present on create
  markupPercent: z.number().nullable(),
  rateLimitRpm: z.number().nullable(),
  allowedModels: z.array(z.string()),
  status: z.enum(["active", "suspended"]),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type RelayConsumerKey = z.infer<typeof relayConsumerKeySchema>;

export const relayKeyOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
  apiKeyPrefix: z.string(),
});
export type RelayKeyOption = z.infer<typeof relayKeyOptionSchema>;

export const discoveredModelSchema = z.object({
  modelId: z.string(),
  name: z.string(),
  ownedBy: z.string().optional(),
  registered: z.boolean(),
  inputPrice: z.string().nullable().optional(),
  outputPrice: z.string().nullable().optional(),
  contextWindow: z.number().nullable().optional(),
  capabilities: z.array(z.string()).nullable().optional(),
});
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>;

export const priceDiffSchema = z.object({
  id: z.number(),
  modelId: z.string(),
  name: z.string(),
  oldInputPrice: z.string(),
  oldOutputPrice: z.string(),
  newInputPrice: z.string(),
  newOutputPrice: z.string(),
  contextWindow: z.number().nullable(),
});
export type PriceDiff = z.infer<typeof priceDiffSchema>;

// ── Gateway Config ─────────────────────────────────────────────────

export const rateLimitRuleSchema = z.object({
  name: z.string(),
  pathPattern: z.string(),
  maxRequests: z.number(),
  windowMs: z.number(),
  dimension: z.enum(["ip", "token", "global"]),
  enabled: z.boolean(),
});
export type RateLimitRule = z.infer<typeof rateLimitRuleSchema>;

export const circuitBreakerConfigSchema = z.object({
  name: z.string(),
  failureThreshold: z.number(),
  resetTimeoutMs: z.number(),
  halfOpenRequests: z.number(),
  enabled: z.boolean(),
});
export type CircuitBreakerConfig = z.infer<typeof circuitBreakerConfigSchema>;

export const timeoutConfigSchema = z.object({
  upstreamFetchMs: z.number().int().positive(),
  streamIdleMs: z.number().int().positive(),
  streamMaxDurationMs: z.number().int().positive(),
  upstreamFetchOverrides: z.array(
    z.object({
      endpointId: z.string().optional(),
      modelId: z.string().optional(),
      upstreamFetchMs: z.number().int().positive(),
    }),
  ),
});
export type TimeoutConfig = z.infer<typeof timeoutConfigSchema>;

export const queueConfigSchema = z.object({
  maxWriteQueueDepth: z.number(),
  maxLogQueueDepth: z.number(),
});
export type QueueConfig = z.infer<typeof queueConfigSchema>;

export const gatewayConfigSchema = z.object({
  rateLimits: z.array(rateLimitRuleSchema),
  circuitBreakers: z.array(circuitBreakerConfigSchema),
  timeouts: timeoutConfigSchema,
  queue: queueConfigSchema,
});
export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export const rateLimitStatusSchema = z.object({
  name: z.string(),
  hits: z.number(),
  rejected: z.number(),
});

export const writeQueueStatusSchema = z.object({
  depth: z.number(),
  dropped: z.number(),
  totalEnqueued: z.number(),
});

export const gatewayStatusSchema = z.object({
  rateLimits: z.array(rateLimitStatusSchema),
  queues: writeQueueStatusSchema,
});
export type GatewayStatus = z.infer<typeof gatewayStatusSchema>;
