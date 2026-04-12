import { z } from "zod";

import { createAgentBody } from "@/web/api/schemas";

// ── Schemas ─────────────────────────────────────────────────────────

export const createFormSchema = createAgentBody.extend({
  name: z.string().min(1, "common.valid.name-required"),
});

export type CreateFormValues = z.infer<typeof createFormSchema>;

/** Settlement token symbol — single source of truth for display. */
export const TOKEN_SYMBOL = "USDC";

export const editFormSchema = z.object({
  name: z.string().min(1, "common.valid.name-required"),
  description: z.string().nullable().optional(),
  perPayLimit: z.string().nullable().optional(),
  dailyLimit: z.string().nullable().optional(),
  monthlyLimit: z.string().nullable().optional(),
  defaultMarkupPercent: z
    .string()
    .optional()
    .refine((v) => !v || (Number(v) >= 0 && Number(v) <= 1000), { message: "common.valid.range" }),
});

export type EditFormValues = z.infer<typeof editFormSchema>;

export const topupSchema = z.object({
  amount: z.string().min(1, "common.valid.amount-required"),
  network: z.string().min(1, "common.valid.network-required"),
});

export type TopupValues = z.infer<typeof topupSchema>;

export const manualTopupFormSchema = z.object({
  amount: z.string().min(1, "common.valid.amount-required"),
  note: z.string().optional(),
});

export type ManualTopupFormValues = z.infer<typeof manualTopupFormSchema>;
