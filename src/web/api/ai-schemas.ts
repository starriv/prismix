import { z } from "zod";

// ── AI Providers ────────────────────────────────────────────────

export const aiProviderSchema = z.object({
  id: z.number(),
  providerId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  apiFormat: z.string(),
  authType: z.string(),
  authConfig: z.record(z.string(), z.unknown()),
  enabled: z.coerce.boolean(),
  loadBalanceStrategy: z.string().optional().default("round-robin"),
  iconUrl: z.string().nullable().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const aiModelSchema = z.object({
  id: z.number(),
  providerId: z.number(),
  modelId: z.string(),
  name: z.string(),
  contextWindow: z.number().nullable().optional(),
  inputPrice: z.string(),
  outputPrice: z.string(),
  capabilities: z.array(z.string()),
  enabled: z.coerce.boolean(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiModel = z.infer<typeof aiModelSchema>;

// ── AI Keys ────────────────────────────────────────────────────

export const aiKeySchema = z.object({
  id: z.number(),
  providerId: z.number(),
  ownerId: z.number().nullable().optional(),
  name: z.string(),
  keyPrefix: z.string(),
  weight: z.number().optional().default(1),
  enabled: z.coerce.boolean(),
  providerName: z.string().optional(),
  ownerName: z.string().nullable().optional(),
  lastUsedAt: z.string().or(z.number()).nullable().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type AiKey = z.infer<typeof aiKeySchema>;

/** @deprecated Use `aiKeySchema` / `AiKey` instead */
export const aiMerchantKeySchema = aiKeySchema;
/** @deprecated Use `AiKey` instead */
export type AiMerchantKey = AiKey;

export const testAiKeyResultSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number().optional(),
  status: z.number().optional(),
  error: z.string().optional(),
});
export type TestAiKeyResult = z.infer<typeof testAiKeyResultSchema>;

// ── AI Usage ────────────────────────────────────────────────────────

const aiUsageBreakdownSchema = z.object({
  providerId: z.string(),
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
  byProvider: z.array(aiUsageBreakdownSchema),
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
  keyId: z.number().nullable(),
  consumerKeyId: z.number().nullable().optional(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.string().nullable(),
  upstreamCost: z.string().nullable().optional(),
  markupPercent: z.number().nullable().optional(),
  latencyMs: z.number().nullable(),
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
  upstreamFetchMs: z.number(),
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
