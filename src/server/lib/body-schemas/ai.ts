/**
 * AI-domain Zod body schemas: providers, models, keys, relay.
 */
import { z } from "zod";

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
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const updateAiProviderBody = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().max(500).optional(),
  apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]).optional(),
  authType: z.enum(["bearer", "api-key"]).optional(),
  authConfig: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  loadBalanceStrategy: z.enum(["round-robin", "random"]).optional(),
  iconUrl: z.string().url().max(500).optional().or(z.literal("")),
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

// ── AI: Keys ──────────────────────────────────────────────────────────

export const createAiKeyBody = z.object({
  providerId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(500),
  ownerId: z.number().int().positive().nullable().optional(),
});

export const updateAiKeyBody = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
});

// ── AI Relay ───────────────────────────────────────────────────────────

/**
 * OpenAI-compatible chat completions request body.
 * Uses .passthrough() to allow provider-specific extra fields (tools, response_format, etc.)
 * to flow through to the upstream provider untouched.
 */
export const aiRelayChatBody = z
  .object({
    model: z.string().min(1),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant", "tool"]),
            content: z.union([z.string(), z.array(z.unknown()), z.null()]),
          })
          .passthrough(),
      )
      .min(1),
    stream: z.boolean().optional().default(false),
    max_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
  })
  .passthrough();

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
