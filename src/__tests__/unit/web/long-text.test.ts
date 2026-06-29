import { describe, expect, it } from "vitest";

import { formatLongText, formatSecretText } from "@/web/components/ui/long-text";

describe("long text formatting", () => {
  it("keeps short regular text unchanged", () => {
    expect(formatLongText("abc-123", 8, 4)).toBe("abc-123");
  });

  it("shows head and tail for long regular text", () => {
    expect(formatLongText("12345678-1234-5678-1234-abcdef123456", 8, 6)).toBe("12345678...123456");
  });

  it("shows secret ellipsis in the middle by default", () => {
    expect(formatSecretText("sk-1234567890abcdef", 8)).toBe("sk-12345...def");
  });

  it("normalizes secrets that already include a trailing ellipsis marker", () => {
    expect(formatSecretText("sk-fa56b...", 8)).toBe("sk-fa...56b");
  });

  it("keeps secret ellipsis in the middle when head and tail would overlap", () => {
    expect(formatSecretText("sk-fa56b1234", 8, 4)).toBe("sk-fa56b...1234");
  });

  it("can show a masked tail when the caller passes an already-masked value", () => {
    expect(formatSecretText("sk-1234567890****", 10, 4)).toBe("sk-1234567...****");
  });

  it("masks short unmasked secrets with first char + ellipsis instead of revealing full value", () => {
    expect(formatSecretText("sk-ab", 8)).toBe("s...");
    expect(formatSecretText("sk-ab", 8, 0)).toBe("s...");
    expect(formatSecretText("a", 8)).toBe("a...");
    expect(formatSecretText("ab", 8)).toBe("a...");
  });

  it("does not double-mask already-masked short values", () => {
    expect(formatSecretText("sk...", 8)).toBe("s...k");
  });

  it("handles emoji and surrogate pairs without splitting", () => {
    const emojiSecret = "sk-👍👍👍👍👍👍👍👍👍👍";
    const result = formatSecretText(emojiSecret, 8, 3);
    expect(result).toContain("...");
    expect(result.endsWith("\u{FFFD}")).toBe(false);
  });

  it("handles CJK characters in secrets", () => {
    const cjkSecret = "密钥-1234567890abcdef";
    const result = formatSecretText(cjkSecret, 8, 3);
    expect(result).toBe("密钥-12345...def");
  });

  it("formatLongText handles boundary length exactly at head+tail+separator", () => {
    expect(formatLongText("123456789012", 4, 4)).toBe("1234...9012");
    expect(formatLongText("12345678901", 4, 4)).toBe("12345678901");
  });

  it("formatLongText handles empty and single-char input", () => {
    expect(formatLongText("", 8, 4)).toBe("");
    expect(formatLongText("a", 8, 4)).toBe("a");
  });
});
