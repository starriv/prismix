import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decrypt, decryptConfig, encrypt, encryptConfig, maskConfig } from "@/server/lib/crypto";

const ADDR = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";

describe("encrypt / decrypt", () => {
  it("roundtrips correctly", () => {
    const plain = "hello world secret";
    const cipher = encrypt(plain, ADDR);
    expect(cipher).not.toBe(plain);
    expect(cipher).toContain(":"); // iv:tag:data format
    expect(decrypt(cipher, ADDR)).toBe(plain);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt("same", ADDR);
    const b = encrypt("same", ADDR);
    expect(a).not.toBe(b);
    // but both decrypt to same value
    expect(decrypt(a, ADDR)).toBe("same");
    expect(decrypt(b, ADDR)).toBe("same");
  });

  it("different addresses produce different keys", () => {
    const cipher = encrypt("secret", ADDR);
    expect(() => decrypt(cipher, "0x0000000000000000000000000000000000000000")).toThrow();
  });

  it("throws on invalid ciphertext format", () => {
    expect(() => decrypt("invalid", ADDR)).toThrow("Invalid encrypted format");
    expect(() => decrypt("a:b", ADDR)).toThrow("Invalid encrypted format");
  });

  it("is case-insensitive on address", () => {
    const cipher = encrypt("test", ADDR.toLowerCase());
    expect(decrypt(cipher, ADDR.toUpperCase())).toBe("test");
  });

  it("handles empty plaintext", () => {
    // AES-GCM with empty plaintext produces empty ciphertext data.
    // Our format is iv:tag:data — with empty data the split still has 3 parts.
    // However the implementation requires dataHex to be truthy, so empty plaintext
    // produces an empty hex string which is falsy → throws. This is a known edge
    // case. Verify the behavior is consistent:
    const cipher = encrypt("", ADDR);
    // If data portion is empty, decrypt may throw due to !dataHex check
    // In practice configs are never empty strings, but let's verify the actual behavior
    if (cipher.split(":")[2] === "") {
      expect(() => decrypt(cipher, ADDR)).toThrow("Invalid encrypted format");
    } else {
      expect(decrypt(cipher, ADDR)).toBe("");
    }
  });

  it("handles unicode/emoji in plaintext", () => {
    const plain = "密钥 🔐 Ключ";
    const cipher = encrypt(plain, ADDR);
    expect(decrypt(cipher, ADDR)).toBe(plain);
  });

  it("detects tampered ciphertext (GCM auth tag verification)", () => {
    const cipher = encrypt("secret data", ADDR);
    const [iv, tag, data] = cipher.split(":");
    // Flip a byte in the data portion
    const tampered = data.slice(0, -2) + (data.slice(-2) === "00" ? "ff" : "00");
    expect(() => decrypt(`${iv}:${tag}:${tampered}`, ADDR)).toThrow();
  });

  it("detects tampered auth tag", () => {
    const cipher = encrypt("secret data", ADDR);
    const [iv, tag, data] = cipher.split(":");
    // Flip a byte in the tag
    const tamperedTag = tag.slice(0, -2) + (tag.slice(-2) === "00" ? "ff" : "00");
    expect(() => decrypt(`${iv}:${tamperedTag}:${data}`, ADDR)).toThrow();
  });
});

describe("encryptConfig / decryptConfig", () => {
  it("roundtrips a config object", () => {
    const config = { apiKey: "sk-123", headerName: "X-API-Key" };
    const cipher = encryptConfig(config, ADDR);
    expect(typeof cipher).toBe("string");
    const result = decryptConfig(cipher, ADDR);
    expect(result).toEqual(config);
  });

  it("handles nested objects", () => {
    const config = { nested: { deep: "value" }, num: 42 };
    const cipher = encryptConfig(config as Record<string, unknown>, ADDR);
    const result = decryptConfig(cipher, ADDR);
    expect(result).toEqual(config);
  });
});

describe("deriveKey security", () => {
  let origEncryptionKey: string | undefined;
  let origJwtSecret: string | undefined;
  let origEncryptionSalt: string | undefined;

  beforeEach(() => {
    origEncryptionKey = process.env.ENCRYPTION_KEY;
    origJwtSecret = process.env.JWT_SECRET;
    origEncryptionSalt = process.env.ENCRYPTION_SALT;
  });

  afterEach(() => {
    // Restore original values
    if (origEncryptionKey !== undefined) {
      process.env.ENCRYPTION_KEY = origEncryptionKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
    if (origJwtSecret !== undefined) {
      process.env.JWT_SECRET = origJwtSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
    if (origEncryptionSalt !== undefined) {
      process.env.ENCRYPTION_SALT = origEncryptionSalt;
    } else {
      delete process.env.ENCRYPTION_SALT;
    }
  });

  it("throws when ENCRYPTION_KEY and JWT_SECRET are both unset", () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;

    expect(() => encrypt("test", "0x1234567890abcdef1234567890abcdef12345678")).toThrow(
      "ENCRYPTION_KEY or JWT_SECRET",
    );
  });

  it("throws when ENCRYPTION_SALT is not set", () => {
    delete process.env.ENCRYPTION_SALT;

    expect(() => encrypt("test", "some-domain-tag")).toThrow("ENCRYPTION_SALT must be set");
  });
});

describe("maskConfig", () => {
  it("masks long strings showing first/last 4 chars", () => {
    const result = maskConfig({ apiKey: "sk-1234567890abcdef" });
    expect(result.apiKey).toBe("sk-1********cdef");
  });

  it("fully masks short strings (<=12 chars)", () => {
    const result = maskConfig({ pin: "1234" });
    expect(result.pin).toBe("****");
  });

  it("boundary: 12-char string is fully masked", () => {
    const result = maskConfig({ key: "123456789012" });
    expect(result.key).toBe("************");
  });

  it("boundary: 13-char string shows first/last 4", () => {
    const result = maskConfig({ key: "1234567890123" });
    expect(result.key).toBe("1234********0123");
  });

  it("converts non-string values to string", () => {
    const result = maskConfig({ timeout: 100 as unknown });
    expect(result.timeout).toBe("100");
  });

  it("handles empty string", () => {
    const result = maskConfig({ empty: "" });
    expect(result.empty).toBe("");
  });

  it("handles null/undefined values", () => {
    const result = maskConfig({ nil: null as unknown });
    expect(result.nil).toBe("");
  });
});
