/**
 * Auth-specific rate limiter — hardcoded protection against brute-force attacks.
 *
 * Applied to authentication endpoints (login, register, nonce).
 * This is independent of the admin-configurable gateway rate limiter.
 *
 * Limits:
 *   - 10 attempts per minute per IP for authenticate/register
 *   - 30 attempts per minute per IP for nonce/initialize (lighter)
 */
import type { Context, MiddlewareHandler, Next } from "hono";

import { getClientIp } from "@/server/lib/client-ip";
import { log } from "@/server/lib/logger";
import { createRateLimitStore } from "@/server/rate-limit";

const store = createRateLimitStore();

const AUTH_LIMIT = 10; // max attempts per window
const AUTH_WINDOW_MS = 60_000; // 1 minute
const INIT_LIMIT = 30; // nonce/initialize is lighter
const INIT_WINDOW_MS = 60_000;

/**
 * Rate-limit middleware for auth endpoints.
 * `kind` determines the limit tier: "auth" (strict) or "init" (relaxed).
 */
export function authRateLimit(kind: "auth" | "init"): MiddlewareHandler {
  const limit = kind === "auth" ? AUTH_LIMIT : INIT_LIMIT;
  const windowMs = kind === "auth" ? AUTH_WINDOW_MS : INIT_WINDOW_MS;

  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const key = `auth-rl:${kind}:${ip}`;

    const result = await store.increment(key, windowMs);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, limit - result.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));

    if (result.count > limit) {
      log.auth.warn({ ip, kind, count: result.count }, "Auth rate limit exceeded");
      c.header("Retry-After", String(Math.ceil(result.resetMs / 1000)));
      return c.json({ error: "Too many attempts, please try again later" }, 429);
    }

    await next();
  };
}
