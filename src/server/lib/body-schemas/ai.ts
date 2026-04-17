/**
 * AI-domain Zod body schemas: providers, models, keys, relay.
 */
import { z } from "zod";

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

// ── AI: Providers ──────────────────────────────────────────────────────

export const createAiProviderBody = z.object({
  providerId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Provider ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().max(500),
  apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]),
  authType: z.enum(["bearer", "api-key", "sigv4"]),
  authConfig: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]).optional(),
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const updateAiProviderBody = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().max(500).optional(),
  apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]).optional(),
  authType: z.enum(["bearer", "api-key", "sigv4"]).optional(),
  authConfig: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  loadBalanceStrategy: z.enum(["round-robin", "random"]).optional(),
  upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]).optional(),
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
});

// ── AI: Global Upstreams ─────────────────────────────────────────────

export const createAiUpstreamBody = z.object({
  name: z.string().min(1).max(100),
  baseUrl: safeUrlSchema,
  kind: z.enum(["official", "reseller", "openrouter", "custom"]).optional(),
  modelsEndpoint: z.string().url().max(500).nullish(),
  enabled: z.boolean().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 4096, "Metadata must be under 4 KB")
    .optional(),
});

export const updateAiUpstreamBody = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: safeUrlSchema.optional(),
  kind: z.enum(["official", "reseller", "openrouter", "custom"]).optional(),
  modelsEndpoint: z.string().url().max(500).nullish(),
  enabled: z.boolean().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 4096, "Metadata must be under 4 KB")
    .optional(),
});

// ── AI: Upstream Assignments (provider ↔ upstream junction) ──────────

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

export const batchCreateAiModelsBody = z.object({
  models: z
    .array(
      z.object({
        modelId: z.string().min(1).max(100),
        name: z.string().min(1).max(200),
        contextWindow: z.number().int().positive().optional(),
        inputPrice: z.string().min(1).default("0"),
        outputPrice: z.string().min(1).default("0"),
        capabilities: z.array(z.string()).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const createAiModelBody = z.object({
  modelId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9._:-]+$/, "Model ID must be lowercase alphanumeric with dots, colons, hyphens"),
  name: z.string().min(1).max(200),
  contextWindow: z.number().int().positive().optional(),
  inputPrice: z.string().min(1).default("0"),
  outputPrice: z.string().min(1).default("0"),
  capabilities: z.array(z.string()).optional(),
  fallbackModelIds: z.array(z.string()).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const updateAiModelBody = z.object({
  name: z.string().min(1).max(200).optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  inputPrice: z.string().min(1).optional(),
  outputPrice: z.string().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  fallbackModelIds: z.array(z.string()).nullable().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ── AI: Model Routes ─────────────────────────────────────────────────

export const createAiModelRouteBody = z.object({
  providerId: z.number().int().positive(),
  providerModelId: z.string().min(1).max(100).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const updateAiModelRouteBody = z.object({
  providerModelId: z.string().min(1).max(100).nullable().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ── AI: Keys ──────────────────────────────────────────────────────────

export const createAiKeyBody = z.object({
  providerId: z.number().int().positive(),
  upstreamId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(10000),
  ownerId: z.number().int().positive().nullable().optional(),
});

export const updateAiKeyBody = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
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
