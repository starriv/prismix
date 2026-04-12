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

export const createKeyProviderBody = z.object({
  name: z.string().min(1, "common.valid.name-required"),
  email: z.string().email("common.valid.invalid-email").optional().or(z.literal("")),
  contactInfo: z.string().optional(),
  address: z.string().optional().or(z.literal("")),
  revenueSharePercent: z.number().min(0).max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});
export type CreateKeyProviderBody = z.infer<typeof createKeyProviderBody>;
