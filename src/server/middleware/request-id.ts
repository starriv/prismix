/**
 * Request ID middleware — generates or propagates X-Request-ID for every request.
 *
 * - Honors incoming `X-Request-ID` header (end-to-end tracing from clients/load balancers)
 * - Falls back to a new UUIDv4 if no header is present
 * - Stores the ID on the Hono context via `c.set("requestId", ...)`
 * - Echoes the ID back in the response `X-Request-ID` header
 */
import crypto from "crypto";

import type { Context, MiddlewareHandler } from "hono";

const HEADER = "X-Request-ID";

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(HEADER);
    // Cap length to prevent log bloat from spoofed headers; reject non-printable chars
    const id =
      incoming && incoming.length <= 128 && !/[\x00-\x1f]/.test(incoming)
        ? incoming
        : crypto.randomUUID();
    c.set("requestId" as never, id);
    c.header(HEADER, id);
    await next();
  };
}

/** Type-safe accessor for the request ID set by requestId() middleware. */
export function getRequestId(c: Context): string {
  return (c.get("requestId" as never) as string) ?? "";
}
