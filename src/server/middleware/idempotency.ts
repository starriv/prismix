/**
 * Idempotency-Key middleware for Hono.
 *
 * Caches POST/PUT responses by a client-provided `Idempotency-Key` header.
 * If the same key is seen again within the TTL, the cached response is returned
 * without executing the handler again — preventing duplicate resource creation.
 *
 * Usage:
 *   app.use("/api/admin/resources", idempotencyGuard());
 *
 * The middleware only activates when the request carries an `Idempotency-Key` header.
 * Requests without the header pass through normally (opt-in idempotency).
 */
import type { Context, Next } from "hono";

import { createCacheStore } from "@/server/cache";
import { log } from "@/server/lib/logger";

interface CachedResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const HEADER_NAME = "idempotency-key";

const store = createCacheStore<CachedResponse>("idempotency");

/**
 * Build a namespaced cache key: idempotency:{adminId}:{idempotencyKey}
 * adminId scoping prevents cross-session collisions.
 */
function buildKey(adminId: number | string, idempotencyKey: string): string {
  return `${adminId}:${idempotencyKey}`;
}

/**
 * Hono middleware factory for idempotent POST/PUT endpoints.
 *
 * Extracts adminId from `c.get("admin")` — must run after adminAuthMiddleware.
 */
export function idempotencyGuard() {
  return async (c: Context, next: Next) => {
    // Only apply to mutation methods
    if (c.req.method !== "POST" && c.req.method !== "PUT") {
      return next();
    }

    const idempotencyKey = c.req.header(HEADER_NAME);
    if (!idempotencyKey) {
      // No header → opt-in, pass through
      return next();
    }

    // Validate key length (prevent abuse)
    if (idempotencyKey.length > 256) {
      return c.json({ error: "Idempotency-Key too long (max 256 characters)" }, 400);
    }

    // Extract adminId from auth session
    const session = c.get("admin") as { adminId: number } | undefined;
    const adminId = session?.adminId ?? "anon";

    const cacheKey = buildKey(adminId, idempotencyKey);

    // Check cache for existing response
    const cached = store.get(cacheKey);
    if (cached) {
      log.auth.debug({ idempotencyKey }, "Idempotency-Key cache hit — returning cached response");
      return c.json(JSON.parse(cached.body), cached.status as 200);
    }

    // Execute handler
    await next();

    // Cache successful responses (2xx) only
    const status = c.res.status;
    if (status >= 200 && status < 300) {
      try {
        const body = await c.res.clone().text();
        const headers: Record<string, string> = {};
        c.res.headers.forEach((v, k) => {
          headers[k] = v;
        });
        store.set(cacheKey, { status, body, headers }, IDEMPOTENCY_TTL_MS);
      } catch {
        // Non-critical — if we can't cache, the next request will just execute again
      }
    }
  };
}
