/**
 * AI-domain Zod body schemas: suppliers, endpoints, credentials, models, relay.
 */
import { z } from "zod";

import { PRICE_RE } from "@/shared/number";

// ── SSRF-safe URL check ─────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const PRIVATE_RANGES = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // CGN 100.64.0.0/10
];

function isSafeUpstreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) return false;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (PRIVATE_RANGES.some((re) => re.test(hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

const safeUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine(isSafeUpstreamUrl, "URL must not point to private or internal network addresses");

const aiAuthTypeSchema = z.enum(["bearer", "api-key", "sigv4", "cloudflare"]);
const aiAuthConfigSchema = z.record(z.string(), z.unknown());
const connectorConfigModeSchema = z.enum(["inherit", "override"]);
const officialConcurrencyLimitSchema = z.number().int().positive().nullable().optional();
const officialQueueTimeoutMsSchema = z
  .number()
  .int()
  .positive()
  .max(30 * 60 * 1000)
  .optional();

// ── AI: Suppliers ─────────────────────────────────────────────────────

export const createAiSupplierBody = z.object({
  supplierId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Supplier ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(100),
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
  authType: aiAuthTypeSchema.optional(),
  authConfig: aiAuthConfigSchema.optional(),
  officialConcurrencyLimit: officialConcurrencyLimitSchema,
  officialQueueTimeoutMs: officialQueueTimeoutMsSchema,
  enabled: z.boolean().optional(),
});

export const updateAiSupplierBody = z.object({
  name: z.string().min(1).max(100).optional(),
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
  authType: aiAuthTypeSchema.optional(),
  authConfig: aiAuthConfigSchema.optional(),
  officialConcurrencyLimit: officialConcurrencyLimitSchema,
  officialQueueTimeoutMs: officialQueueTimeoutMsSchema,
  enabled: z.boolean().optional(),
});

// ── AI: Endpoints ─────────────────────────────────────────────────────

export const createAiEndpointBody = z.object({
  supplierId: z.number().int().positive(),
  endpointId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Endpoint ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().max(500),
  apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]),
  authMode: connectorConfigModeSchema.optional(),
  authType: aiAuthTypeSchema.optional(),
  authConfig: aiAuthConfigSchema.optional(),
  enabled: z.boolean().optional(),
  upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]).optional(),
  concurrencyMode: connectorConfigModeSchema.optional(),
  officialConcurrencyLimit: officialConcurrencyLimitSchema,
  officialQueueTimeoutMs: officialQueueTimeoutMsSchema,
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const updateAiEndpointBody = z.object({
  supplierId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().max(500).optional(),
  apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]).optional(),
  authMode: connectorConfigModeSchema.optional(),
  authType: aiAuthTypeSchema.optional(),
  authConfig: aiAuthConfigSchema.optional(),
  enabled: z.boolean().optional(),
  loadBalanceStrategy: z.enum(["round-robin", "random"]).optional(),
  upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]).optional(),
  concurrencyMode: connectorConfigModeSchema.optional(),
  officialConcurrencyLimit: officialConcurrencyLimitSchema,
  officialQueueTimeoutMs: officialQueueTimeoutMsSchema,
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
});

// ── AI: Global Upstreams ─────────────────────────────────────────────

export const createAiUpstreamBody = z.object({
  name: z.string().min(1).max(100),
  baseUrl: safeUrlSchema,
  kind: z.enum(["official", "reseller", "openrouter", "custom"]).optional(),
  modelsEndpoint: safeUrlSchema.nullish(),
  enabled: z.boolean().optional(),
  concurrencyLimit: z.number().int().positive().nullable().optional(),
  queueTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(30 * 60 * 1000)
    .optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 4096, "Metadata must be under 4 KB")
    .optional(),
});

export const updateAiUpstreamBody = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: safeUrlSchema.optional(),
  kind: z.enum(["official", "reseller", "openrouter", "custom"]).optional(),
  modelsEndpoint: safeUrlSchema.nullish(),
  enabled: z.boolean().optional(),
  concurrencyLimit: z.number().int().positive().nullable().optional(),
  queueTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(30 * 60 * 1000)
    .optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 4096, "Metadata must be under 4 KB")
    .optional(),
});

// ── AI: Upstream Model Mappings ─────────────────────────────────────

export const createAiUpstreamModelMappingBody = z.object({
  sourceModelId: z.string().min(1).max(200),
  mappedModelId: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
});

export const updateAiUpstreamModelMappingBody = z.object({
  mappedModelId: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
});

// ── AI: Upstream Assignments (endpoint ↔ upstream junction) ──────────

export const createAiUpstreamAssignmentBody = z.object({
  upstreamId: z.number().int().positive(),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const updateAiUpstreamAssignmentBody = z.object({
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ── AI: Models ─────────────────────────────────────────────────────────

const limitedFreeUntilSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => Number.isFinite(Date.parse(value)), "Invalid limited-free expiry")
    .transform((value) => new Date(value))
    .nullable(),
);

export const batchCreateAiModelsBody = z.object({
  models: z
    .array(
      z.object({
        modelId: z.string().min(1).max(100),
        name: z.string().min(1).max(200),
        contextWindow: z.number().int().positive().nullable().optional(),
        inputPrice: z.string().min(1).regex(PRICE_RE, "Invalid price format").default("0"),
        outputPrice: z.string().min(1).regex(PRICE_RE, "Invalid price format").default("0"),
        capabilities: z.array(z.string()).optional(),
        limitedFreeUntil: limitedFreeUntilSchema.optional(),
        grayReleaseEnabled: z.boolean().optional(),
        grayUserIds: z.array(z.number().int().positive()).max(1000).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const createAiModelBody = z.object({
  modelId: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  contextWindow: z.number().int().positive().nullable().optional(),
  inputPrice: z.string().min(1).regex(PRICE_RE, "Invalid price format").default("0"),
  outputPrice: z.string().min(1).regex(PRICE_RE, "Invalid price format").default("0"),
  capabilities: z.array(z.string()).optional(),
  fallbackModelIds: z.array(z.string()).optional(),
  limitedFreeUntil: limitedFreeUntilSchema.optional(),
  grayReleaseEnabled: z.boolean().optional(),
  grayUserIds: z.array(z.number().int().positive()).max(1000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const updateAiModelBody = z.object({
  name: z.string().min(1).max(200).optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  inputPrice: z.string().min(1).regex(PRICE_RE, "Invalid price format").optional(),
  outputPrice: z.string().min(1).regex(PRICE_RE, "Invalid price format").optional(),
  capabilities: z.array(z.string()).optional(),
  fallbackModelIds: z.array(z.string()).nullable().optional(),
  limitedFreeUntil: limitedFreeUntilSchema.optional(),
  grayReleaseEnabled: z.boolean().optional(),
  grayUserIds: z.array(z.number().int().positive()).max(1000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ── AI: Model Routes ─────────────────────────────────────────────────

export const createAiModelRouteBody = z.object({
  endpointId: z.number().int().positive(),
  endpointModelId: z.string().min(1).max(100).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const updateAiModelRouteBody = z.object({
  endpointModelId: z.string().min(1).max(100).nullable().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ── AI: Credentials ───────────────────────────────────────────────────

export const createAiCredentialBody = z.object({
  supplierId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(10000),
  ownerId: z.number().int().positive().nullable().optional(),
});

export const updateAiCredentialBody = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
});

export const createAiEndpointCredentialBody = z.object({
  endpointId: z.number().int().positive(),
  credentialId: z.number().int().positive(),
  upstreamId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(100).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const updateAiEndpointCredentialBody = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  upstreamId: z.number().int().positive().nullable().optional(),
});

// ── AI Relay ───────────────────────────────────────────────────────────

/** Coerce a value to a positive integer or undefined. Accepts number, numeric string, null. */
const coercePositiveInt = z.preprocess((v) => {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return v; // let Zod reject
  return Math.trunc(n);
}, z.number().int().positive().optional());

/** Coerce a value to a number in range or undefined. Accepts number, numeric string, null. */
const coerceFloat = (min: number, max: number) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return undefined;
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) return v;
    return n;
  }, z.number().min(min).max(max).optional());

/**
 * OpenAI-compatible chat completions request body.
 * Uses .passthrough() to allow provider-specific extra fields (tools, response_format, etc.)
 * to flow through to the upstream provider untouched.
 *
 * Compatibility:
 * - max_tokens / max_completion_tokens: coerced from string/null, merged into max_tokens.
 * - temperature / top_p: coerced from string/null.
 */
export const aiRelayChatBody = z
  .object({
    model: z.string().min(1),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "developer", "user", "assistant", "tool"]),
            content: z.union([z.string(), z.array(z.unknown()), z.null()]),
          })
          .passthrough(),
      )
      .min(1),
    stream: z.boolean().optional().default(false),
    max_tokens: coercePositiveInt,
    max_completion_tokens: coercePositiveInt,
    temperature: coerceFloat(0, 2),
    top_p: coerceFloat(0, 1),
  })
  .passthrough()
  .transform((data) => {
    // Normalize: max_completion_tokens → max_tokens (OpenAI newer field → canonical)
    const { max_completion_tokens, ...rest } = data;
    return {
      ...rest,
      max_tokens: rest.max_tokens ?? max_completion_tokens,
    };
  });

// ── Relay Consumer Keys ───────────────────────────────────────────────

export const createConsumerKeyBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  userId: z.number().int().positive().optional(), // link key to an existing user's wallet
  markupPercent: z.number().min(0).max(1000).nullable().optional(),
  rateLimitRpm: z.number().int().positive().optional(),
  allowedModels: z.array(z.string()).optional(),
  initialBalance: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});

export const updateConsumerKeyBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  agentId: z.number().int().positive().optional(),
  markupPercent: z.number().min(0).max(1000).nullable().optional(),
  rateLimitRpm: z.number().int().positive().nullable().optional(),
  allowedModels: z.array(z.string()).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});
