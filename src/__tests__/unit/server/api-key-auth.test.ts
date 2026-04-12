/**
 * API Key auth strategy unit tests — covers the dual-channel authentication
 * (JWT + API Key) in adminAuthMiddleware.
 *
 * Mocks external deps (jwt, repos, crypto, write-queue) to isolate the
 * strategy chain logic.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Do NOT mock @/server/lib/crypto — we need the real hashApiKey for roundtrip
// Do NOT mock @/server/lib/jwt — we use real JWT sign/verify for integration

// Import after mocks are set up
import { hashApiKey } from "@/server/lib/crypto";
import { initJwtSecret, signAccessToken } from "@/server/lib/jwt";
import { adminAuthMiddleware, getAdminSession } from "@/server/middleware/auth";

// ── Mocks ───────────────────────────────────────────────────────────

const mockFindByHash = vi.fn();
const mockEnqueueJob = vi.fn();

vi.mock("@/server/repos", () => ({
  apiKeyRepo: {
    findByHash: (...args: unknown[]) => mockFindByHash(...args),
  },
}));

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

// ── Setup ───────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-for-api-key-auth-tests-32chars!!";
  initJwtSecret();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────

function createAdminApp() {
  const app = new Hono();
  app.use("/*", adminAuthMiddleware);
  app.get("/test", (c) => {
    const session = getAdminSession(c);
    return c.json({
      adminId: session.adminId,
      address: session.address,
      source: session.source,
      keyId: session.keyId,
    });
  });
  return app;
}

/** Build a fake API Key row as returned by apiKeyRepo.findByHash. */
function buildApiKeyRow(
  overrides: Partial<{
    id: number;
    adminId: number;
    status: string;
    expiresAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 10,
    adminId: overrides.adminId ?? 42,
    name: "Test Key",
    clientId: "skm_id_abcdef123456",
    secretHash: "mock-hash",
    secretPrefix: "skm_abcd1234",
    scopes: null,
    status: overrides.status ?? "active",
    lastUsedAt: null,
    expiresAt: overrides.expiresAt ?? null,
    revokedAt: null,
    createdAt: new Date(),
  };
}

// ── JWT path ────────────────────────────────────────────────────────

describe("adminAuthMiddleware — JWT path", () => {
  it("valid admin JWT → sets AdminSession with source=jwt", async () => {
    const token = await signAccessToken({ userId: 42, address: "0xABC", role: "admin" });
    const app = createAdminApp();

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminId).toBe(42);
    expect(body.address).toBe("0xABC");
    expect(body.source).toBe("jwt");
    expect(body.keyId).toBeUndefined();
  });

  it("invalid JWT → returns 401", async () => {
    const app = createAdminApp();

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer not.a.valid.jwt.token" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("user JWT on admin route → returns 401 (wrong role)", async () => {
    const token = await signAccessToken({ userId: 1, role: "user" });
    const app = createAdminApp();

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
  });
});

// ── API Key path ────────────────────────────────────────────────────

describe("adminAuthMiddleware — API Key path", () => {
  const RAW_KEY = "skm_aabbccdd11223344aabbccdd11223344";

  it("valid active API key → sets AdminSession with source=api_key and keyId", async () => {
    const hash = hashApiKey(RAW_KEY);
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ id: 10, adminId: 42 }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminId).toBe(42);
    expect(body.source).toBe("api_key");
    expect(body.keyId).toBe(10);
    expect(body.address).toBeUndefined();

    // Verify hashApiKey was called correctly (repo received the hash)
    expect(mockFindByHash).toHaveBeenCalledWith(hash);

    // Verify async last_used_at update was enqueued
    expect(mockEnqueueJob).toHaveBeenCalledWith("api-key-touch", { apiKeyId: 10 });
  });

  it("revoked API key → returns 401", async () => {
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ status: "revoked" }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(401);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("expired API key → returns 401", async () => {
    const pastDate = new Date(Date.now() - 60_000); // 1 minute ago
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ expiresAt: pastDate }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(401);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("non-existent API key (hash not found) → returns 401", async () => {
    mockFindByHash.mockResolvedValueOnce(undefined);

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(401);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("API key with future expiresAt → passes authentication", async () => {
    const futureDate = new Date(Date.now() + 3_600_000); // 1 hour from now
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ expiresAt: futureDate }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("api_key");
  });

  it("API key with null expiresAt (no expiry) → passes authentication", async () => {
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ expiresAt: null }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${RAW_KEY}` },
    });

    expect(res.status).toBe(200);
  });
});

// ── No token ────────────────────────────────────────────────────────

describe("adminAuthMiddleware — missing Authorization", () => {
  it("missing Authorization header → returns 401", async () => {
    const app = createAdminApp();
    const res = await app.request("/test");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("empty Bearer value → returns 401", async () => {
    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer " },
    });

    expect(res.status).toBe(401);
  });

  it("unsupported Authorization scheme → returns 401", async () => {
    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Digest username=foo" },
    });

    expect(res.status).toBe(401);
  });
});

// ── X-API-Key header ────────────────────────────────────────────────

describe("adminAuthMiddleware — X-API-Key header", () => {
  const RAW_KEY = "skm_aabbccdd11223344aabbccdd11223344";

  it("X-API-Key header with valid key → authenticates", async () => {
    const hash = hashApiKey(RAW_KEY);
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ id: 20, adminId: 99 }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { "X-API-Key": RAW_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminId).toBe(99);
    expect(body.source).toBe("api_key");
    expect(body.keyId).toBe(20);
    expect(mockFindByHash).toHaveBeenCalledWith(hash);
  });

  it("X-API-Key takes priority over Authorization header", async () => {
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ id: 20, adminId: 99 }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: {
        "X-API-Key": RAW_KEY,
        Authorization: "Bearer invalid.jwt.token",
      },
    });

    // X-API-Key should be used, not the Bearer token
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("api_key");
  });
});

// ── Basic Auth ──────────────────────────────────────────────────────

describe("adminAuthMiddleware — Basic auth", () => {
  const RAW_KEY = "skm_aabbccdd11223344aabbccdd11223344";
  const CLIENT_ID = "skm_id_abcdef123456";

  it("Basic auth with clientId:secret → authenticates via API Key strategy", async () => {
    const encoded = btoa(`${CLIENT_ID}:${RAW_KEY}`);
    const hash = hashApiKey(RAW_KEY);
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ id: 30, adminId: 77 }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Basic ${encoded}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminId).toBe(77);
    expect(body.source).toBe("api_key");
    expect(body.keyId).toBe(30);
    expect(mockFindByHash).toHaveBeenCalledWith(hash);
  });

  it("Basic auth with secret only (no colon) → authenticates", async () => {
    const encoded = btoa(RAW_KEY);
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow({ id: 31, adminId: 78 }));

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Basic ${encoded}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("api_key");
  });

  it("Basic auth with invalid base64 → returns 401", async () => {
    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Basic !!!not-base64!!!" },
    });

    expect(res.status).toBe(401);
  });

  it("Basic auth with empty password → returns 401", async () => {
    const encoded = btoa("client_id_only:");
    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Basic ${encoded}` },
    });

    expect(res.status).toBe(401);
  });
});

// ── Strategy dispatch ───────────────────────────────────────────────

describe("strategy dispatch — prefix routing", () => {
  it("skm_ prefix routes to ApiKeyAuthStrategy, not JWT", async () => {
    // A skm_ token should never reach JWT verification
    mockFindByHash.mockResolvedValueOnce(buildApiKeyRow());

    const app = createAdminApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer skm_any_value_here_1234567890ab" },
    });

    expect(res.status).toBe(200);
    expect(mockFindByHash).toHaveBeenCalled();
  });

  it("non-skm_ token routes to JwtAuthStrategy, not API Key", async () => {
    // A regular JWT should never hit apiKeyRepo
    const token = await signAccessToken({ userId: 1, role: "admin" });
    const app = createAdminApp();

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(mockFindByHash).not.toHaveBeenCalled();
  });
});
