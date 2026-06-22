/**
 * Custom HTTP header validation — shared by server and web.
 *
 * Validates that user-provided headers conform to HTTP standards
 * and don't include dangerous/reserved headers that could break
 * the gateway or upstream connection.
 */

/** RFC 7230: token = 1*tchar. Header names must match this. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Header values must not contain control characters (except HTAB).
 * RFC 7230 §3.2.6: field-value = *( field-content / obs-fold )
 */
function hasInvalidHeaderValueChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code < 32 && code !== 9) || code === 127) return true;
  }
  return false;
}

/** Headers that must never be set by user config — they break HTTP transport or security. */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "via",
]);

const MAX_HEADERS = 20;
const MAX_NAME_LEN = 128;
const MAX_VALUE_LEN = 4096;

export interface HeaderValidationResult {
  valid: boolean;
  error?: string;
  /** Sanitized headers (only present when valid) */
  headers?: Record<string, string>;
}

/**
 * Validate and sanitize a custom headers object.
 * Returns { valid: true, headers } on success, { valid: false, error } on failure.
 */
export function validateCustomHeaders(input: unknown): HeaderValidationResult {
  if (input === null || input === undefined) {
    return { valid: true, headers: {} };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Custom headers must be a JSON object" };
  }

  const entries = Object.entries(input as Record<string, unknown>);

  if (entries.length > MAX_HEADERS) {
    return { valid: false, error: `Too many headers (max ${MAX_HEADERS})` };
  }

  const sanitized: Record<string, string> = {};

  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim();

    // Name validation
    if (!name) {
      return { valid: false, error: "Header name cannot be empty" };
    }
    if (name.length > MAX_NAME_LEN) {
      return { valid: false, error: `Header name "${name}" exceeds ${MAX_NAME_LEN} characters` };
    }
    if (!HEADER_NAME_RE.test(name)) {
      return {
        valid: false,
        error: `Header name "${name}" contains invalid characters (must be ASCII token chars)`,
      };
    }

    // Forbidden check
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      return { valid: false, error: `Header "${name}" is reserved and cannot be set` };
    }

    // Value validation
    if (typeof rawValue !== "string") {
      return { valid: false, error: `Header "${name}" value must be a string` };
    }
    const value = rawValue.trim();
    if (value.length > MAX_VALUE_LEN) {
      return {
        valid: false,
        error: `Header "${name}" value exceeds ${MAX_VALUE_LEN} characters`,
      };
    }
    if (hasInvalidHeaderValueChar(value)) {
      return {
        valid: false,
        error: `Header "${name}" value contains invalid control characters`,
      };
    }

    sanitized[name] = value;
  }

  return { valid: true, headers: sanitized };
}
