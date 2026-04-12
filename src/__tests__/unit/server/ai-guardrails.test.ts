/**
 * Content guardrails — Phase 3 Feature 3 unit tests.
 */
import { describe, expect, it } from "vitest";

import {
  checkInputGuardrails,
  checkOutputGuardrails,
  type GuardrailConfig,
} from "@/server/ai/lib/guardrails";

// ── Keyword Blocklist ───────────────────────────────────────────────────

describe("keyword_blocklist", () => {
  const config: GuardrailConfig = {
    rules: [{ type: "keyword_blocklist", config: { patterns: ["password", "secret\\s*key"] } }],
    action: "block",
  };

  it("blocks messages containing blocked keywords", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "What is the password for the admin?" }],
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Blocked content");
    expect(result.flaggedContent).toContain("password");
  });

  it("blocks regex patterns", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "Give me the secret key" }],
      config,
    );
    expect(result.allowed).toBe(false);
  });

  it("allows clean messages", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "What is the weather today?" }],
      config,
    );
    expect(result.allowed).toBe(true);
  });

  it("works on output guardrails too", () => {
    const result = checkOutputGuardrails("The password is 12345", config);
    expect(result.allowed).toBe(false);
  });
});

// ── Max Message Length ───────────────────────────────────────────────────

describe("max_message_length", () => {
  const config: GuardrailConfig = {
    rules: [{ type: "max_message_length", config: { maxLength: 100 } }],
    action: "block",
  };

  it("blocks messages exceeding max length", () => {
    const result = checkInputGuardrails([{ role: "user", content: "a".repeat(101) }], config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("maximum length");
  });

  it("allows messages within limit", () => {
    const result = checkInputGuardrails([{ role: "user", content: "Hello world" }], config);
    expect(result.allowed).toBe(true);
  });

  it("considers combined length of all messages", () => {
    const result = checkInputGuardrails(
      [
        { role: "user", content: "a".repeat(60) },
        { role: "assistant", content: "b".repeat(60) },
      ],
      config,
    );
    expect(result.allowed).toBe(false);
  });
});

// ── PII Detection ───────────────────────────────────────────────────────

describe("pii_detection", () => {
  const config: GuardrailConfig = {
    rules: [{ type: "pii_detection", config: {} }],
    action: "block",
  };

  it("detects email addresses", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "Contact me at user@example.com" }],
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.flaggedContent?.some((f) => f.includes("email"))).toBe(true);
  });

  it("detects phone numbers", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "Call me at 555-123-4567" }],
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.flaggedContent?.some((f) => f.includes("phone"))).toBe(true);
  });

  it("detects SSN patterns", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "My SSN is 123-45-6789" }],
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.flaggedContent?.some((f) => f.includes("ssn"))).toBe(true);
  });

  it("detects credit card numbers", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "Card: 4111 1111 1111 1111" }],
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.flaggedContent?.some((f) => f.includes("credit_card"))).toBe(true);
  });

  it("allows clean text", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "Tell me about the weather" }],
      config,
    );
    expect(result.allowed).toBe(true);
  });
});

// ── Multiple Rules ──────────────────────────────────────────────────────

describe("multiple rules", () => {
  const config: GuardrailConfig = {
    rules: [
      { type: "max_message_length", config: { maxLength: 1000 } },
      { type: "keyword_blocklist", config: { patterns: ["hack"] } },
      { type: "pii_detection", config: {} },
    ],
    action: "block",
  };

  it("fails on first violated rule", () => {
    const result = checkInputGuardrails([{ role: "user", content: "hack the system" }], config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Blocked content");
  });

  it("passes when all rules pass", () => {
    const result = checkInputGuardrails(
      [{ role: "user", content: "What is machine learning?" }],
      config,
    );
    expect(result.allowed).toBe(true);
  });
});

// ── Empty Rules ─────────────────────────────────────────────────────────

describe("empty rules", () => {
  it("allows everything with no rules", () => {
    const result = checkInputGuardrails([{ role: "user", content: "anything goes" }], {
      rules: [],
      action: "block",
    });
    expect(result.allowed).toBe(true);
  });
});
