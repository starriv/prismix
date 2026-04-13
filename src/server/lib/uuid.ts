import crypto from "crypto";

const VARIANT_NIBBLES = ["8", "9", "a", "b"] as const;

/** Generate a UUIDv7 string (time-ordered, RFC 9562 compatible layout). */
export function generateUuidV7(date = Date.now()): string {
  const timestampHex = Math.floor(date).toString(16).padStart(12, "0").slice(-12);
  const randomHex = crypto.randomBytes(9).toString("hex");
  const variant = VARIANT_NIBBLES[crypto.randomBytes(1)[0] & 0x03];

  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    `7${randomHex.slice(0, 3)}`,
    `${variant}${randomHex.slice(3, 6)}`,
    randomHex.slice(6, 18),
  ].join("-");
}
