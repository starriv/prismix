import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OidcStrategy, resetDiscoveryCache } from "@/server/auth/strategies/oidc";
import { getProviderCredentials, getProviderFullConfig } from "@/server/lib/auth-provider-config";

// Mock dependencies before importing the strategy
vi.mock("@/server/cache", () => ({
  createCacheStore: () => {
    const store = new Map<string, { value: unknown; expiry: number }>();
    return {
      get: (key: string) => {
        const entry = store.get(key);
        if (!entry || entry.expiry < Date.now()) {
          store.delete(key);
          return undefined;
        }
        return entry.value;
      },
      set: (key: string, value: unknown, ttl: number) => {
        store.set(key, { value, expiry: Date.now() + ttl });
      },
      del: (key: string) => store.delete(key),
      has: (key: string) => store.has(key),
      clear: () => store.clear(),
      size: () => store.size,
    };
  },
  lazyCacheStore: () => {
    const store = new Map<string, { value: unknown; expiry: number }>();
    return {
      get: (key: string) => {
        const entry = store.get(key);
        if (!entry || entry.expiry < Date.now()) {
          store.delete(key);
          return undefined;
        }
        return entry.value;
      },
      set: (key: string, value: unknown, ttl: number) => {
        store.set(key, { value, expiry: Date.now() + ttl });
      },
      del: (key: string) => store.delete(key),
      has: (key: string) => store.has(key),
      clear: () => store.clear(),
      size: () => store.size,
    };
  },
}));

vi.mock("@/server/lib/auth-provider-config", () => ({
  getProviderCredentials: vi.fn(),
  getProviderFullConfig: vi.fn(),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  },
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

const MOCK_DISCOVERY = {
  issuer: "https://test.idp.com",
  authorization_endpoint: "https://test.idp.com/authorize",
  token_endpoint: "https://test.idp.com/token",
  userinfo_endpoint: "https://test.idp.com/userinfo",
  jwks_uri: "https://test.idp.com/.well-known/jwks.json",
};
const ORIGINAL_CORS_ORIGIN = process.env.CORS_ORIGIN;

function mockConfig(overrides?: Record<string, unknown>) {
  vi.mocked(getProviderFullConfig).mockReturnValue({
    enabled: true,
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    issuer: "https://test.idp.com",
    ...overrides,
  });
  vi.mocked(getProviderCredentials).mockReturnValue({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  });
}

function mockFetch(responses: Array<{ ok: boolean; json?: unknown; text?: string }>) {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  for (const res of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: res.ok,
      json: () => Promise.resolve(res.json),
      text: () => Promise.resolve(res.text ?? ""),
    } as Response);
  }
  return fetchMock;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("OidcStrategy", () => {
  let strategy: OidcStrategy;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CORS_ORIGIN = "https://app.example.com";
    resetDiscoveryCache();
    strategy = new OidcStrategy();
    mockConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_CORS_ORIGIN === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = ORIGINAL_CORS_ORIGIN;
  });

  // ── Discovery ────────────────────────────────────────────────────

  describe("discovery", () => {
    it("fetches and uses discovery document for initialize", async () => {
      const fetchMock = mockFetch([{ ok: true, json: MOCK_DISCOVERY }]);

      const result = await strategy.initialize({ scope: "merchant" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.idp.com/.well-known/openid-configuration",
      );
      const url = result.data.url as string;
      expect(url).toContain("https://test.idp.com/authorize");
      expect(url).toContain("client_id=test-client-id");
    });

    it("caches discovery within TTL", async () => {
      const fetchMock = mockFetch([
        { ok: true, json: MOCK_DISCOVERY },
        // Second call should NOT trigger fetch
      ]);

      await strategy.initialize({ scope: "merchant" });
      await strategy.initialize({ scope: "merchant" });

      // Only one fetch for discovery (not two)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws on discovery failure", async () => {
      mockFetch([{ ok: false, text: "Not Found" }]);

      await expect(strategy.initialize({ scope: "merchant" })).rejects.toThrow(
        "OIDC discovery failed",
      );
    });
  });

  // ── Initialize ───────────────────────────────────────────────────

  describe("initialize", () => {
    it("builds correct authorize URL with required params", async () => {
      mockFetch([{ ok: true, json: MOCK_DISCOVERY }]);

      const result = await strategy.initialize({ scope: "merchant" });
      const url = new URL(result.data.url as string);

      expect(url.origin + url.pathname).toBe("https://test.idp.com/authorize");
      expect(url.searchParams.get("client_id")).toBe("test-client-id");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toContain("openid");
      expect(url.searchParams.get("scope")).toContain("email");
      expect(url.searchParams.get("scope")).toContain("profile");
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("nonce")).toBeTruthy();
    });

    it("includes extra scopes from config", async () => {
      mockConfig({ scopes: ["groups", "roles"] });
      mockFetch([{ ok: true, json: MOCK_DISCOVERY }]);

      const result = await strategy.initialize({});
      const url = new URL(result.data.url as string);
      const scope = url.searchParams.get("scope")!;

      expect(scope).toContain("groups");
      expect(scope).toContain("roles");
    });

    it("throws when issuer not configured", async () => {
      vi.mocked(getProviderFullConfig).mockReturnValue({
        enabled: true,
        clientId: "id",
        clientSecret: "secret",
      });

      await expect(strategy.initialize({})).rejects.toThrow("OIDC issuer not configured");
    });

    it("throws when client credentials not configured", async () => {
      vi.mocked(getProviderCredentials).mockReturnValue({
        clientId: "",
        clientSecret: "",
      });

      await expect(strategy.initialize({})).rejects.toThrow(
        "OIDC client credentials not configured",
      );
    });
  });

  // ── Authenticate ─────────────────────────────────────────────────

  describe("authenticate", () => {
    async function initAndGetState() {
      mockFetch([{ ok: true, json: MOCK_DISCOVERY }]);
      const result = await strategy.initialize({ scope: "merchant" });
      const url = new URL(result.data.url as string);
      return {
        state: url.searchParams.get("state")!,
        nonce: url.searchParams.get("nonce")!,
      };
    }

    it("valid code + state returns AuthIdentity", async () => {
      const { state, nonce } = await initAndGetState();

      // Mock token exchange + userinfo
      const fetchMock = mockFetch([
        // Discovery (cached, but re-mock for authenticate)
        { ok: true, json: MOCK_DISCOVERY },
        // Token exchange
        {
          ok: true,
          json: { id_token: "mock-id-token", access_token: "mock-access-token" },
        },
        // Userinfo
        {
          ok: true,
          json: {
            sub: "user-123",
            email: "user@company.com",
            name: "Alice",
            picture: "https://avatar.url",
          },
        },
      ]);

      // Mock jose jwtVerify
      vi.mocked(jwtVerify).mockResolvedValueOnce({
        payload: { sub: "user-123", email: "user@company.com", name: "Alice", nonce },
        protectedHeader: { alg: "RS256" },
      } as never);

      // Reset discovery to force re-fetch for authenticate
      resetDiscoveryCache();

      const identity = await strategy.authenticate({ code: "auth-code", state });

      expect(identity.provider).toBe("oidc");
      expect(identity.providerAccountId).toBe("user-123");
      expect(identity.profile?.email).toBe("user@company.com");
      expect(identity.profile?.name).toBe("Alice");
      expect(fetchMock).toHaveBeenCalled();
    });

    it("invalid state throws nonce_expired", async () => {
      // Don't call initialize — no valid state exists
      mockFetch([{ ok: true, json: MOCK_DISCOVERY }]);
      resetDiscoveryCache();

      await expect(
        strategy.authenticate({ code: "auth-code", state: "invalid-state" }),
      ).rejects.toThrow("Invalid or expired OIDC state");
    });

    it("missing code or state throws", async () => {
      await expect(strategy.authenticate({ code: "", state: "" })).rejects.toThrow(
        "Authorization code and state are required",
      );
    });

    it("token exchange failure throws provider_error", async () => {
      const { state } = await initAndGetState();
      resetDiscoveryCache();

      mockFetch([
        { ok: true, json: MOCK_DISCOVERY },
        { ok: false, text: "invalid_grant" },
      ]);

      await expect(strategy.authenticate({ code: "bad-code", state })).rejects.toThrow(
        "OIDC token exchange failed",
      );
    });

    it("missing id_token in response throws", async () => {
      const { state } = await initAndGetState();
      resetDiscoveryCache();

      mockFetch([
        { ok: true, json: MOCK_DISCOVERY },
        { ok: true, json: { access_token: "at" } }, // no id_token
      ]);

      await expect(strategy.authenticate({ code: "code", state })).rejects.toThrow(
        "OIDC provider did not return an ID token",
      );
    });

    it("nonce mismatch in ID token throws signature_invalid", async () => {
      const { state } = await initAndGetState();
      resetDiscoveryCache();

      mockFetch([
        { ok: true, json: MOCK_DISCOVERY },
        { ok: true, json: { id_token: "mock-token", access_token: "at" } },
      ]);

      vi.mocked(jwtVerify).mockResolvedValueOnce({
        payload: { sub: "user-123", nonce: "wrong-nonce" },
        protectedHeader: { alg: "RS256" },
      } as never);

      await expect(strategy.authenticate({ code: "code", state })).rejects.toThrow(
        "ID token nonce mismatch",
      );
    });

    it("supplements profile from userinfo endpoint", async () => {
      const { state, nonce } = await initAndGetState();
      resetDiscoveryCache();

      mockFetch([
        { ok: true, json: MOCK_DISCOVERY },
        { ok: true, json: { id_token: "tok", access_token: "at" } },
        // Userinfo returns additional fields
        {
          ok: true,
          json: {
            sub: "u1",
            email: "full@company.com",
            name: "Full Name",
            picture: "https://pic.url",
          },
        },
      ]);

      vi.mocked(jwtVerify).mockResolvedValueOnce({
        payload: { sub: "u1", nonce },
        protectedHeader: { alg: "RS256" },
      } as never);

      const identity = await strategy.authenticate({ code: "code", state });

      expect(identity.profile?.email).toBe("full@company.com");
      expect(identity.profile?.name).toBe("Full Name");
      expect(identity.profile?.avatar).toBe("https://pic.url");
    });

    it("works without userinfo endpoint", async () => {
      const { state, nonce } = await initAndGetState();
      resetDiscoveryCache();

      // Discovery without userinfo_endpoint
      const discoveryNoUserinfo = { ...MOCK_DISCOVERY, userinfo_endpoint: undefined };
      mockFetch([
        { ok: true, json: discoveryNoUserinfo },
        { ok: true, json: { id_token: "tok", access_token: "at" } },
      ]);

      vi.mocked(jwtVerify).mockResolvedValueOnce({
        payload: { sub: "u1", email: "jwt@co.com", name: "JWT User", nonce },
        protectedHeader: { alg: "RS256" },
      } as never);

      const identity = await strategy.authenticate({ code: "code", state });

      expect(identity.providerAccountId).toBe("u1");
      expect(identity.profile?.email).toBe("jwt@co.com");
    });
  });
});
