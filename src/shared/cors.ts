/**
 * Resource-level CORS configuration — shared by server and web.
 *
 * Follows the standard CORS spec (Fetch Standard / RFC 6454):
 *   Access-Control-Allow-Origin
 *   Access-Control-Allow-Methods
 *   Access-Control-Allow-Headers
 *   Access-Control-Expose-Headers
 *   Access-Control-Max-Age
 *   Access-Control-Allow-Credentials
 */

export interface CorsConfig {
  /** Allowed origins. `["*"]` = any origin. Empty = CORS disabled (same-origin only). */
  origins: string[];
  /** Allowed HTTP methods. Defaults to `["GET", "POST", "OPTIONS"]` if omitted. */
  methods?: string[];
  /** Allowed request headers the client may send. Defaults to common safe headers. */
  allowHeaders?: string[];
  /** Response headers the browser may read. */
  exposeHeaders?: string[];
  /** Preflight cache duration in seconds. Default 86400 (24h). */
  maxAge?: number;
  /** Whether to allow credentials (cookies / Authorization header). Default false. */
  credentials?: boolean;
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const MAX_ORIGINS = 20;
const MAX_MAX_AGE = 86400 * 7; // 7 days

export interface CorsValidationResult {
  valid: boolean;
  error?: string;
  config?: CorsConfig;
}

/** Validate and normalize a CORS config object. */
export function validateCorsConfig(input: unknown): CorsValidationResult {
  if (input === null || input === undefined) {
    return { valid: true, config: { origins: [] } };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "CORS config must be a JSON object" };
  }

  const raw = input as Record<string, unknown>;

  // origins — required array of strings
  if (!Array.isArray(raw.origins)) {
    return { valid: false, error: "origins must be an array" };
  }
  if (raw.origins.length > MAX_ORIGINS) {
    return { valid: false, error: `Too many origins (max ${MAX_ORIGINS})` };
  }
  for (const o of raw.origins) {
    if (typeof o !== "string" || o.length === 0) {
      return { valid: false, error: "Each origin must be a non-empty string" };
    }
    if (o !== "*") {
      try {
        const url = new URL(o);
        if (!url.protocol.startsWith("http")) {
          return { valid: false, error: `Invalid origin "${o}": must be http(s)` };
        }
      } catch {
        return { valid: false, error: `Invalid origin "${o}": must be a valid URL or "*"` };
      }
    }
  }

  // methods
  if (raw.methods !== undefined) {
    if (!Array.isArray(raw.methods)) {
      return { valid: false, error: "methods must be an array" };
    }
    for (const m of raw.methods) {
      if (typeof m !== "string" || !VALID_METHODS.has(m.toUpperCase())) {
        return { valid: false, error: `Invalid method "${m}"` };
      }
    }
  }

  // allowHeaders / exposeHeaders — arrays of strings
  for (const field of ["allowHeaders", "exposeHeaders"] as const) {
    if (raw[field] !== undefined) {
      if (!Array.isArray(raw[field])) {
        return { valid: false, error: `${field} must be an array` };
      }
      for (const h of raw[field] as unknown[]) {
        if (typeof h !== "string") {
          return { valid: false, error: `${field} entries must be strings` };
        }
      }
    }
  }

  // maxAge
  if (raw.maxAge !== undefined) {
    if (typeof raw.maxAge !== "number" || raw.maxAge < 0 || raw.maxAge > MAX_MAX_AGE) {
      return { valid: false, error: `maxAge must be 0–${MAX_MAX_AGE}` };
    }
  }

  // credentials
  if (raw.credentials !== undefined && typeof raw.credentials !== "boolean") {
    return { valid: false, error: "credentials must be a boolean" };
  }

  // credentials: true + wildcard origin is invalid per Fetch spec
  if (raw.credentials === true && (raw.origins as string[]).includes("*")) {
    return { valid: false, error: "credentials cannot be used with wildcard origin" };
  }

  return {
    valid: true,
    config: {
      origins: raw.origins as string[],
      methods: raw.methods as string[] | undefined,
      allowHeaders: raw.allowHeaders as string[] | undefined,
      exposeHeaders: raw.exposeHeaders as string[] | undefined,
      maxAge: raw.maxAge as number | undefined,
      credentials: raw.credentials as boolean | undefined,
    },
  };
}

/** Default methods when not specified */
export const DEFAULT_CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** Default allowed headers when not specified */
export const DEFAULT_CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
];
