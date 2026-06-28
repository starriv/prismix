import { describe, expect, it } from "vitest";

import { resolveConnectorRuntimeConfig } from "@/server/ai/lib/connector-runtime-config";

describe("connector runtime config", () => {
  const endpoint = {
    authMode: "inherit",
    authType: "bearer",
    authConfig: "{}",
    concurrencyMode: "inherit",
    officialConcurrencyLimit: 2,
    officialQueueTimeoutMs: 10_000,
  };

  const supplier = {
    authType: "api-key",
    authConfig: JSON.stringify({ headerName: "X-Supplier-Key" }),
    officialConcurrencyLimit: 12,
    officialQueueTimeoutMs: 60_000,
  };

  it("resolves supplier defaults for inherited auth and concurrency", () => {
    expect(resolveConnectorRuntimeConfig(endpoint, supplier)).toEqual({
      authMode: "inherit",
      authType: "api-key",
      authConfig: JSON.stringify({ headerName: "X-Supplier-Key" }),
      concurrencyMode: "inherit",
      officialConcurrencyLimit: 12,
      officialQueueTimeoutMs: 60_000,
    });
  });

  it("keeps endpoint fields for override mode", () => {
    expect(
      resolveConnectorRuntimeConfig(
        {
          ...endpoint,
          authMode: "override",
          authType: "cloudflare",
          authConfig: JSON.stringify({ clientId: "client.access" }),
          concurrencyMode: "override",
        },
        supplier,
      ),
    ).toMatchObject({
      authMode: "override",
      authType: "cloudflare",
      authConfig: JSON.stringify({ clientId: "client.access" }),
      concurrencyMode: "override",
      officialConcurrencyLimit: 2,
      officialQueueTimeoutMs: 10_000,
    });
  });

  it("falls back to endpoint fields when supplier defaults are unavailable", () => {
    expect(resolveConnectorRuntimeConfig(endpoint, null)).toMatchObject({
      authMode: "inherit",
      authType: "bearer",
      concurrencyMode: "inherit",
      officialConcurrencyLimit: 2,
      officialQueueTimeoutMs: 10_000,
    });
  });
});
