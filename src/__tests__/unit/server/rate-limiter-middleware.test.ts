/**
 * Rate limiter middleware integration test.
 *
 * Tests the full HTTP flow: request → rate limiter → 200/429 response.
 * Single test case to avoid state leakage from the module-scoped store singleton.
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createRateLimiterMiddleware } from "@/server/middleware/rate-limiter";

// Mock gateway-config to control rate limit rules
vi.mock("@/server/lib/gateway-config", () => ({
  getGatewayConfigCached: vi.fn(() => ({
    rateLimits: [
      {
        name: "test-rule",
        enabled: true,
        pathPattern: "/api/*",
        dimension: "ip",
        maxRequests: 5,
        windowMs: 60000,
      },
    ],
    circuitBreakers: {},
    timeouts: { upstreamFetchMs: 5000 },
    queue: { maxLogQueueDepth: 100, maxWriteQueueDepth: 100 },
  })),
  initGatewayConfig: vi.fn(),
}));

// Mock Redis — rate-limit uses eval (returns incrementing counter), cache uses duplicate/subscribe
let evalCounter = 0;
vi.mock("@/server/lib/redis", () => ({
  getRedis: () => ({
    eval: vi.fn().mockImplementation(() => Promise.resolve(++evalCounter)),
    duplicate: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    }),
    publish: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  }),
  closeRedis: vi.fn(),
}));

describe("createRateLimiterMiddleware", () => {
  const app = new Hono();
  app.use("*", createRateLimiterMiddleware());
  app.get("/api/test", (c) => c.json({ ok: true }));
  app.get("/other", (c) => c.json({ ok: true }));

  it("passes requests within limit, then rejects with 429 + correct headers", async () => {
    // First request: allowed, headers set
    const r1 = await app.request("/api/test");
    expect(r1.status).toBe(200);
    expect(r1.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(Number(r1.headers.get("X-RateLimit-Remaining"))).toBe(4);

    // Exhaust remaining (4 more, total 5)
    for (let i = 0; i < 4; i++) {
      const res = await app.request("/api/test");
      expect(res.status).toBe(200);
    }

    // 6th request: rate limited
    const r6 = await app.request("/api/test");
    expect(r6.status).toBe(429);
    const body = await r6.json();
    expect(body.error).toBe("Rate limit exceeded");
    expect(r6.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(r6.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("does not rate limit paths outside the rule pattern", async () => {
    // /other does not match /api/* — always passes
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/other");
      expect(res.status).toBe(200);
    }
  });
});
