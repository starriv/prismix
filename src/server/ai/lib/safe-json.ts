/**
 * Safe JSON parsers with Zod validation for DB JSON text columns.
 *
 * All JSON text columns are stored as `text` in PostgreSQL. These helpers
 * parse + validate at the boundary, replacing bare `JSON.parse(...) as T` casts.
 */
import { z } from "zod";

import { log } from "@/server/lib/logger";

import type { GuardrailRule } from "./guardrails";

// ── Schemas ─────────────────────────────────────────────────────────

const stringArraySchema = z.array(z.string());

const guardrailRuleSchema = z.object({
  type: z.enum(["keyword_blocklist", "max_message_length", "pii_detection"]),
  config: z.record(z.string(), z.unknown()),
});

const guardrailRulesSchema = z.array(guardrailRuleSchema);

// ── Public API ──────────────────────────────────────────────────────

/**
 * Parse a JSON text column expected to be `string[]`.
 * Returns `[]` on null/invalid input with a warning log.
 */
export function safeParseJsonArray(value: string | null, label: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const result = stringArraySchema.safeParse(parsed);
    if (result.success) return result.data;
    log.gateway.warn({ label, errors: result.error.issues }, "JSON column is not a string array");
    return [];
  } catch {
    log.gateway.warn({ label }, "JSON column parse failed");
    return [];
  }
}

/**
 * Parse a JSON text column expected to be `GuardrailRule[]`.
 * Returns `null` on invalid input with a warning log (caller should skip guardrails).
 */
export function safeParseGuardrailRules(value: string): GuardrailRule[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = guardrailRulesSchema.safeParse(parsed);
    if (result.success) return result.data;
    log.gateway.warn({ errors: result.error.issues }, "Guardrail rules JSON is malformed");
    return null;
  } catch {
    log.gateway.warn("Guardrail rules JSON parse failed");
    return null;
  }
}
