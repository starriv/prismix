/**
 * Payment/Wallet Zod body schemas: deposits, withdrawals, top-up orders.
 */
import { z } from "zod";

// ── Regex validators ────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRICE_RE = /^\d+(\.\d+)?$/;
const MAX_BASE64_IMAGE_LENGTH = 5 * 1024 * 1024;

/** Allowed MIME prefixes for base64 image uploads (no SVG — XSS risk). */
const SAFE_IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|gif|webp);base64,/;

// ── User Wallet ────────────────────────────────────────────────────────

export const verifyDepositBody = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
  network: z.string().min(1, "Network is required"),
});

export const withdrawBody = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("crypto"),
      toAddress: z.string().regex(ETH_ADDRESS_RE, "Invalid Ethereum address"),
      amount: z.string().regex(PRICE_RE, "Invalid amount format").optional(),
      withdrawAll: z.boolean().optional(),
      network: z.string().min(1, "Network is required"),
    })
    .refine((d) => d.withdrawAll || d.amount, {
      message: "Either amount or withdrawAll must be provided",
    }),
  z.object({
    type: z.literal("fiat"),
    paymentMethod: z.string().min(1, "Payment method is required").max(100),
    payoutInfo: z.string().min(1, "Payout info is required").max(1000),
    amount: z.string().regex(PRICE_RE, "Invalid amount format"),
    note: z.string().max(500).optional(),
  }),
]);

// ── Top-up Order ──────────────────────────────────────────────────

export const createTopupRequestBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("crypto"),
    amount: z.string().min(1, "Amount is required").regex(PRICE_RE, "Invalid amount format"),
    network: z.string().min(1, "Network is required"),
  }),
  z.object({
    type: z.literal("fiat"),
    amount: z.string().min(1, "Amount is required").regex(PRICE_RE, "Invalid amount format"),
    fiatConfigId: z.number().int().positive(),
    fiatCurrency: z.string().min(1).max(10).optional(),
  }),
]);

export const confirmTopupOrderBody = z.object({
  fiatAmount: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
});

export const rejectTopupOrderBody = z.object({
  note: z.string().max(500).optional(),
});

export const submitFiatTopupProofBody = z.object({
  paymentProof: z
    .string()
    .min(1, "Payment proof is required")
    .max(MAX_BASE64_IMAGE_LENGTH, "Payment proof is too large")
    .refine((v) => SAFE_IMAGE_DATA_URL_RE.test(v), {
      message: "Only PNG, JPEG, GIF, or WebP images are accepted",
    }),
});
