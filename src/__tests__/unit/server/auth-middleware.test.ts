/**
 * Auth middleware unit tests — covers adminAuthMiddleware,
 * getAdminSession, and verifyTokenForSSE.
 *
 * Uses a real JWT secret (in-process) via initJwtSecret() to test the full
 * JWT sign → middleware verify flow without mocking jose internals.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initJwtSecret, signAccessToken } from "@/server/lib/jwt";
import { adminAuthMiddleware, getAdminSession, verifyTokenForSSE } from "@/server/middleware/auth";

// ── Setup ────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-for-auth-middleware-unit-tests-32chars!";
  initJwtSecret();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

function createAdminApp() {
  const app = new Hono();
  app.use("/*", adminAuthMiddleware);
  app.get("/test", (c) => {
    const session = getAdminSession(c);
    return c.json({ adminId: session.adminId, address: session.address });
  });
  return app;
}

// ── adminAuthMiddleware ────────────────────────────────────────────

describe("adminAuthMiddleware", () => {
  it("passes with a valid admin token and populates session", async () => {
    const token = await signAccessToken({ userId: 7, address: "0xAdmin", role: "admin" });
    const app = createAdminApp();

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminId).toBe(7);
    expect(body.address).toBe("0xAdmin");
  });

  it("rejects a user token (wrong role)", async () => {
    const token = await signAccessToken({ userId: 1, role: "user" });
    const app = createAdminApp();

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
  });

  it("rejects when no Authorization header", async () => {
    const app = createAdminApp();
    const res = await app.request("/test");

    expect(res.status).toBe(401);
  });
});

// ── verifyTokenForSSE ──────────────────────────────────────────────

describe("verifyTokenForSSE", () => {
  it("returns role and userId for a valid user token", async () => {
    const token = await signAccessToken({ userId: 55, role: "user" });
    const result = await verifyTokenForSSE(token);

    expect(result).toEqual({ role: "user", userId: 55 });
  });

  it("returns role and userId for a valid admin token", async () => {
    const token = await signAccessToken({ userId: 1, role: "admin" });
    const result = await verifyTokenForSSE(token);

    expect(result).toEqual({ role: "admin", userId: 1 });
  });

  it("returns null for an invalid token", async () => {
    const result = await verifyTokenForSSE("garbage.token.here");
    expect(result).toBeNull();
  });

  it("returns null for an empty string", async () => {
    const result = await verifyTokenForSSE("");
    expect(result).toBeNull();
  });
});
