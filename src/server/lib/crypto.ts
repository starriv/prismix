import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const ITERATIONS = 100_000;

// ── PBKDF2 key cache ──────────────────────────────────────────────────
// PBKDF2 with 100k iterations costs ~10-20ms per call. Cache derived keys
// to avoid this cost on the gateway hot path (signing engine decryption).

const KEY_CACHE_TTL = 5 * 60_000; // 5 minutes
const KEY_CACHE_MAX = 1_000; // max entries to prevent unbounded growth

interface KeyCacheEntry {
  key: Buffer;
  expiresAt: number;
}

const keyCache = new Map<string, KeyCacheEntry>();

/**
 * Derive a 256-bit AES key from a domain tag + server secret + ENCRYPTION_SALT.
 *
 * PBKDF2 password = ENCRYPTION_KEY (or JWT_SECRET) + domain tag
 * PBKDF2 salt     = ENCRYPTION_SALT (env var) + domain tag
 *
 * Domain tags provide per-entity/per-module separation (e.g.
 * "auth-provider-config", "agent-private-key", "ai-merchant-key").
 */
function getEncryptionSalt(): string {
  const salt = process.env.ENCRYPTION_SALT;
  if (!salt) throw new Error("ENCRYPTION_SALT must be set for credential encryption");
  return salt;
}

function deriveKey(domainTag: string): Buffer {
  const normalized = domainTag.toLowerCase();
  const entry = keyCache.get(normalized);
  if (entry && Date.now() < entry.expiresAt) return entry.key;

  const serverSecret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!serverSecret) {
    throw new Error("ENCRYPTION_KEY or JWT_SECRET must be set for credential encryption");
  }
  const encSalt = getEncryptionSalt();
  const password = `${serverSecret}:${normalized}`;
  const salt = `${encSalt}:${normalized}`;
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, "sha256");
  // Evict oldest entry if at cap (FIFO — Map insertion order)
  // Zero-fill evicted key buffer to prevent residual secrets in heap memory
  if (keyCache.size >= KEY_CACHE_MAX && !keyCache.has(normalized)) {
    const first = keyCache.keys().next().value;
    if (first !== undefined) {
      const evicted = keyCache.get(first);
      if (evicted) evicted.key.fill(0);
      keyCache.delete(first);
    }
  }
  keyCache.set(normalized, { key, expiresAt: Date.now() + KEY_CACHE_TTL });
  return key;
}

/** Encrypt plaintext using a domain tag. Returns hex string `iv:tag:ciphertext` */
export function encrypt(plaintext: string, salt: string): string {
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a value previously encrypted with `encrypt()` */
export function decrypt(ciphertext: string, salt: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted format");
  }
  const key = deriveKey(salt);
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ── API Key helpers ──────────────────────────────────────────────────

/** Hash an API key with SHA-256 for storage. */
export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Relay Consumer Key helpers ──────────────────────────────────────

const CONSUMER_API_KEY_PREFIX = "ska_";

/** Generate a new AI Gateway consumer key: `ska_<32 hex chars>`. Returns raw key, hash, and display prefix. */
export function generateConsumerApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `${CONSUMER_API_KEY_PREFIX}${crypto.randomBytes(16).toString("hex")}`;
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 8);
  return { raw, hash, prefix };
}

// ── Admin API Key helpers ────────────────────────────────────────────

const ADMIN_KEY_PREFIX = "skm_";

/** Generate a new Admin API Key. Returns clientId, secret (show once), hash, and display prefix. */
export function generateAdminApiKey(): {
  clientId: string;
  secret: string;
  secretHash: string;
  secretPrefix: string;
} {
  const clientId = `skm_id_${crypto.randomBytes(6).toString("hex")}`;
  const secret = `${ADMIN_KEY_PREFIX}${crypto.randomBytes(16).toString("hex")}`;
  const secretHash = hashApiKey(secret);
  const secretPrefix = secret.slice(0, 12);
  return { clientId, secret, secretHash, secretPrefix };
}

// ── Config encryption helpers ─────────────────────────────────────────

/** Encrypt a config object (JSON → AES-256-GCM) */
export function encryptConfig(config: Record<string, unknown>, salt: string): string {
  return encrypt(JSON.stringify(config), salt);
}

/** Decrypt a config blob back to an object */
export function decryptConfig(ciphertext: string, salt: string): Record<string, unknown> {
  const json = decrypt(ciphertext, salt);
  return JSON.parse(json) as Record<string, unknown>;
}

/** Mask sensitive values in a config for API responses (never expose raw secrets) */
export function maskConfig(config: Record<string, unknown>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value.length > 0) {
      if (value.length > 12) {
        masked[key] = `${value.slice(0, 4)}${"*".repeat(8)}${value.slice(-4)}`;
      } else {
        masked[key] = "*".repeat(value.length);
      }
    } else {
      masked[key] = String(value ?? "");
    }
  }
  return masked;
}
