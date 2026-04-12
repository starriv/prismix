import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { getRequestId, requestId } from "@/server/middleware/request-id";

function createApp() {
  const app = new Hono();
  app.use("*", requestId());
  app.get("/test", (c) => c.json({ requestId: getRequestId(c) }));
  return app;
}

describe("request-id middleware", () => {
  it("generates a UUID when no X-Request-ID header is present", async () => {
    const app = createApp();
    const res = await app.request("/test");
    const body = await res.json();

    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("honors incoming X-Request-ID header", async () => {
    const app = createApp();
    const customId = "my-trace-id-123";
    const res = await app.request("/test", {
      headers: { "X-Request-ID": customId },
    });
    const body = await res.json();

    expect(body.requestId).toBe(customId);
  });

  it("sets X-Request-ID response header", async () => {
    const app = createApp();
    const res = await app.request("/test");
    const header = res.headers.get("X-Request-ID");

    expect(header).toBeTruthy();
    expect(header).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("echoes back the incoming X-Request-ID in the response", async () => {
    const app = createApp();
    const customId = "echo-test-456";
    const res = await app.request("/test", {
      headers: { "X-Request-ID": customId },
    });

    expect(res.headers.get("X-Request-ID")).toBe(customId);
  });

  it("returns consistent requestId in body and response header", async () => {
    const app = createApp();
    const res = await app.request("/test");
    const body = await res.json();
    const header = res.headers.get("X-Request-ID");

    expect(body.requestId).toBe(header);
  });

  it("rejects oversized X-Request-ID (> 128 chars)", async () => {
    const app = createApp();
    const oversized = "a".repeat(129);
    const res = await app.request("/test", {
      headers: { "X-Request-ID": oversized },
    });
    const body = await res.json();

    // Should generate a new UUID instead of using the spoofed value
    expect(body.requestId).not.toBe(oversized);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("rejects X-Request-ID with control characters", async () => {
    const app = createApp();
    // Use \x01 (SOH) since \x00 is rejected by the Headers API itself
    const malicious = "bad\x01id";
    const res = await app.request("/test", {
      headers: { "X-Request-ID": malicious },
    });
    const body = await res.json();

    // Should generate a new UUID instead of using the value with control chars
    expect(body.requestId).not.toBe(malicious);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("accepts valid X-Request-ID up to 128 chars", async () => {
    const app = createApp();
    const maxLength = "a".repeat(128);
    const res = await app.request("/test", {
      headers: { "X-Request-ID": maxLength },
    });
    const body = await res.json();

    expect(body.requestId).toBe(maxLength);
  });
});
