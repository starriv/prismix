/**
 * Request ID middleware — generates or propagates X-Request-ID for every request.
 *
 * - Honors incoming `X-Request-ID` header (end-to-end tracing from clients/load balancers)
 * - Falls back to a new UUIDv4 if no header is present
 * - Stores the ID on the Hono context via `c.set("requestId", ...)`
 * - Stores the ID in AsyncLocalStorage so pino mixin can inject it automatically
 * - Echoes the ID back in the response `X-Request-ID` header
 */
import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import type { Context, MiddlewareHandler } from "hono";

const HEADER = "X-Request-ID";

/** AsyncLocalStorage holding the current request ID. Used by pino mixin. */
export const requestIdStore = new AsyncLocalStorage<string>();

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return true;
  }
  return false;
}

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(HEADER);
    // Cap length to prevent log bloat from spoofed headers; reject non-printable chars
    const id =
      incoming && incoming.length <= 128 && !hasControlChar(incoming)
        ? incoming
        : crypto.randomUUID();
    c.set("requestId" as never, id);
    c.header(HEADER, id);
    await requestIdStore.run(id, next);
  };
}

/** Type-safe accessor for the request ID set by requestId() middleware. */
export function getRequestId(c: Context): string {
  return (c.get("requestId" as never) as string) ?? "";
}
