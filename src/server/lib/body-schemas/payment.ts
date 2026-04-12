/**
 * Payment/Wallet Zod body schemas: deposits, withdrawals, top-up orders.
 */
import { z } from "zod";

// ── Regex validators ────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRICE_RE = /^\d+(\.\d+)?$/;

// ── User Wallet ────────────────────────────────────────────────────────

export const verifyDepositBody = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
  network: z.string().min(1, "Network is required"),
});

export const withdrawBody = z
  .object({
    toAddress: z.string().regex(ETH_ADDRESS_RE, "Invalid Ethereum address"),
    amount: z.string().regex(PRICE_RE, "Invalid amount format").optional(),
    withdrawAll: z.boolean().optional(),
    network: z.string().min(1, "Network is required"),
  })
  .refine((d) => d.withdrawAll || d.amount, {
    message: "Either amount or withdrawAll must be provided",
  });

// ── Top-up Order ──────────────────────────────────────────────────

export const createTopupRequestBody = z.object({
  amount: z.string().min(1, "Amount is required").regex(PRICE_RE, "Invalid amount format"),
  network: z.string().min(1, "Network is required"),
});

export const confirmTopupOrderBody = z.object({
  fiatAmount: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
});

export const rejectTopupOrderBody = z.object({
  note: z.string().max(500).optional(),
});
