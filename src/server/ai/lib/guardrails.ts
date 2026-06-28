/**
 * Content guardrails — rule-based input/output filtering for AI relay requests.
 *
 * Built-in rule types (no external API calls):
 * - keyword_blocklist: regex patterns for prohibited terms
 * - max_message_length: per-message and total character limits
 * - pii_detection: regex patterns for email, phone, SSN, credit card
 */
import { match } from "ts-pattern";

import type { OpenAIChatMessage } from "../protocol-adapters/types";

// ── Types ────────────────────────────────────────────────────────────

export interface GuardrailRule {
  type: "keyword_blocklist" | "max_message_length" | "pii_detection";
  config: Record<string, unknown>;
}

export interface GuardrailConfig {
  rules: GuardrailRule[];
  action: "block" | "warn" | "log";
}

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  flaggedContent?: string[];
}

// ── PII Patterns ─────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone", pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
];

// ── Rule Evaluation ──────────────────────────────────────────────────

function evaluateRule(rule: GuardrailRule, text: string): GuardrailResult {
  return match(rule.type)
    .with("keyword_blocklist", () => {
      const patterns = (rule.config.patterns as string[]) ?? [];
      const flagged: string[] = [];

      for (const pattern of patterns) {
        try {
          const regex = new RegExp(pattern, "gi");
          const matches = text.match(regex);
          if (matches) flagged.push(...matches);
        } catch {
          // Invalid regex — skip
        }
      }

      return flagged.length > 0
        ? { allowed: false, reason: "Blocked content detected", flaggedContent: flagged }
        : { allowed: true };
    })
    .with("max_message_length", () => {
      const maxLength = (rule.config.maxLength as number) ?? 100_000;
      if (text.length > maxLength) {
        return {
          allowed: false,
          reason: `Message exceeds maximum length of ${maxLength} characters`,
          flaggedContent: [`length: ${text.length}`],
        };
      }
      return { allowed: true };
    })
    .with("pii_detection", () => {
      const flagged: string[] = [];

      for (const { name, pattern } of PII_PATTERNS) {
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
        const matches = text.match(pattern);
        if (matches) {
          flagged.push(...matches.map((m) => `${name}: ${m}`));
        }
      }

      return flagged.length > 0
        ? { allowed: false, reason: "PII detected in content", flaggedContent: flagged }
        : { allowed: true };
    })
    .exhaustive();
}

// ── Public API ───────────────────────────────────────────────────────

/** Check input messages against guardrail rules. */
export function checkInputGuardrails(
  messages: OpenAIChatMessage[],
  config: GuardrailConfig,
): GuardrailResult {
  const allText = messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");

  for (const rule of config.rules) {
    const result = evaluateRule(rule, allText);
    if (!result.allowed) return result;
  }

  return { allowed: true };
}

/** Check output content against guardrail rules. */
export function checkOutputGuardrails(content: string, config: GuardrailConfig): GuardrailResult {
  for (const rule of config.rules) {
    const result = evaluateRule(rule, content);
    if (!result.allowed) return result;
  }

  return { allowed: true };
}
