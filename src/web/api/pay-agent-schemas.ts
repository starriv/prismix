import { z } from "zod";

// ── Pay Agent ────────────────────────────────────────────────────

export const payAgentSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: z.string().default("standard"), // "standard" | "ledger"
  balance: z.string(),
  status: z.string(),
  address: z.string().nullable(),
  perPayLimit: z.string().nullable().optional(),
  dailyLimit: z.string().nullable().optional(),
  monthlyLimit: z.string().nullable().optional(),
  defaultMarkupPercent: z.number().nullable(),
  userId: z.number().nullable().optional(),
  userUuid: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PayAgent = z.infer<typeof payAgentSchema>;

export const createAgentBody = z.object({
  name: z.string(),
  description: z.string().optional(),
  defaultMarkupPercent: z.number().nullable().optional(),
});
export type CreateAgentBody = z.infer<typeof createAgentBody>;

export const updateAgentBody = z.object({
  id: z.number(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  type: z.enum(["standard", "ledger"]).optional(),
  perPayLimit: z.string().nullable().optional(),
  dailyLimit: z.string().nullable().optional(),
  monthlyLimit: z.string().nullable().optional(),
  defaultMarkupPercent: z.number().nullable().optional(),
});
export type UpdateAgentBody = z.infer<typeof updateAgentBody>;

export const topupAgentBody = z.object({
  txHash: z.string(),
  network: z.string(),
});
export type TopupAgentBody = z.infer<typeof topupAgentBody>;

export const manualTopupBody = z.object({
  amount: z.string().min(1, "common.valid.amount-required"),
  note: z.string().optional(),
});
export type ManualTopupBody = z.infer<typeof manualTopupBody>;

export const payAgentTransactionSchema = z.object({
  id: z.number(),
  agentId: z.number(),
  type: z.string(),
  amount: z.string(),
  balanceBefore: z.string(),
  balanceAfter: z.string(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  txHash: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  source: z.string().optional().default("platform"),
  consumerKeyId: z.number().nullable().optional(),
  modelId: z.string().nullable().optional(),
  tokens: z.number().nullable().optional(),
  requestId: z.string().nullable().optional(),
  upstreamCost: z.string().nullable().optional(),
  markupPercent: z.number().nullable().optional(),
  createdAt: z.string(),
});
export type PayAgentTransaction = z.infer<typeof payAgentTransactionSchema>;

// ── Top-up Orders ───────────────────────────────────────────────

export const topUpOrderSchema = z.object({
  id: z.number(),
  agentId: z.number(),
  userId: z.number().nullable().optional(),
  userUuid: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  amount: z.string(),
  fiatAmount: z.string().nullable().optional(),
  fiatCurrency: z.string(),
  type: z.enum(["crypto", "fiat"]).default("crypto"),
  fiatConfigId: z.number().nullable().optional(),
  status: z.string(), // pending | confirmed | rejected | expired
  paymentMethod: z.string().nullable().optional(),
  paymentProof: z.string().nullable().optional(),
  adminNote: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  toAddress: z.string().nullable().optional(),
  txHash: z.string().nullable().optional(),
  confirmedAt: z.string().or(z.number()).nullable().optional(),
  expiredAt: z.string().or(z.number()).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type TopUpOrder = z.infer<typeof topUpOrderSchema>;

export const topUpOrderListSchema = z.object({
  items: z.array(topUpOrderSchema),
  total: z.number(),
});
export type TopUpOrderList = z.infer<typeof topUpOrderListSchema>;

export const confirmTopupBody = z.object({
  fiatAmount: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
});
export type ConfirmTopupBody = z.infer<typeof confirmTopupBody>;

export const rejectTopupBody = z.object({
  note: z.string().max(500).optional(),
});
export type RejectTopupBody = z.infer<typeof rejectTopupBody>;
