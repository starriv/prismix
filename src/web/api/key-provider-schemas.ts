import { z } from "zod";

// ── Key Providers ────────────────────────────────────────────────

export const keyProviderSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().nullable().optional(),
  contactInfo: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  revenueSharePercent: z.number(),
  balance: z.string(),
  status: z.string(),
  keyCount: z.number().optional(),
  latestCallAt: z.string().nullable().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type KeyProvider = z.infer<typeof keyProviderSchema>;

export const keyProviderTransactionSchema = z.object({
  id: z.number(),
  providerId: z.number(),
  keyId: z.number().nullable().optional(),
  type: z.string(),
  amount: z.string(),
  balanceBefore: z.string(),
  balanceAfter: z.string(),
  description: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
  createdAt: z.string().or(z.number()),
});
export type KeyProviderTransaction = z.infer<typeof keyProviderTransactionSchema>;

export const keyProviderKeySummarySchema = z.object({
  keyId: z.number(),
  keyName: z.string(),
  keyPrefix: z.string(),
  providerId: z.number(),
  providerName: z.string().nullable().optional(),
  upstreamId: z.number().nullable().optional(),
  upstreamName: z.string().nullable().optional(),
  enabled: z.coerce.boolean(),
  weight: z.number(),
  lastUsedAt: z.string().or(z.number()).nullable().optional(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  consumerSpend: z.string(),
  upstreamCost: z.string(),
  revenueShare: z.string(),
});
export type KeyProviderKeySummary = z.infer<typeof keyProviderKeySummarySchema>;

export const keyProviderKeysSchema = z.array(keyProviderKeySummarySchema);
export type KeyProviderKeys = z.infer<typeof keyProviderKeysSchema>;

export const keyProviderTotalsSchema = z.object({
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  consumerSpend: z.string(),
  upstreamCost: z.string(),
  revenueShare: z.string(),
});
export type KeyProviderTotals = z.infer<typeof keyProviderTotalsSchema>;

export const keyProviderSummarySchema = keyProviderSchema.extend({
  keyCount: z.number(),
  totals: keyProviderTotalsSchema,
});
export type KeyProviderSummary = z.infer<typeof keyProviderSummarySchema>;

export const createKeyProviderBody = z.object({
  name: z.string().min(1, "common.valid.name-required"),
  email: z.string().email("common.valid.invalid-email").optional().or(z.literal("")),
  contactInfo: z.string().optional(),
  address: z.string().optional().or(z.literal("")),
  revenueSharePercent: z.number().min(0).max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});
export type CreateKeyProviderBody = z.infer<typeof createKeyProviderBody>;
