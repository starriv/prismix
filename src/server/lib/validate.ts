/**
 * Server-side request body validation.
 *
 * Wraps c.req.json() with try-catch and Zod parsing in a single call.
 * Returns a typed result or a 400 JSON error response.
 */
import type { Context } from "hono";
import type { z } from "zod";

type ParseOk<T> = { ok: true; data: T; error?: undefined; response?: undefined };
type ParseFail = { ok: false; data?: undefined; error: string; response: Response };

/**
 * Parse and validate the JSON request body against a Zod schema.
 *
 * @example
 * const parsed = await parseBody(c, createResourceBody);
 * if (!parsed.ok) return parsed.response;
 * const { name, path } = parsed.data;
 */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<ParseOk<z.infer<T>> | ParseFail> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      error: "Invalid JSON body",
      response: c.json({ error: "Invalid JSON body" }, 400),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${String(i.path.join("."))}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      error: message,
      response: c.json({ error: message }, 400),
    };
  }

  return { ok: true, data: result.data as z.infer<T> };
}

/**
 * Parse a URL/query parameter as a positive integer.
 * Returns null if the value is undefined, empty, or not a valid positive integer.
 */
export function parseIntParam(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Server-side default page size — keep in sync with web `DEFAULT_PAGE_SIZE`. */
export const DEFAULT_PAGE_LIMIT = 10;

/**
 * Parse a pagination `limit` parameter with a maximum cap.
 * Returns the default if the value is missing or invalid.
 */
export function parsePaginationLimit(
  value: string | undefined,
  defaultLimit = DEFAULT_PAGE_LIMIT,
  maxLimit = 100,
): number {
  const n = parseIntParam(value);
  if (n === null) return defaultLimit;
  return Math.min(n, maxLimit);
}

/**
 * Parse a pagination `offset` parameter.
 * Returns 0 if the value is missing or invalid.
 */
export function parsePaginationOffset(value: string | undefined): number {
  return parseIntParam(value) ?? 0;
}
