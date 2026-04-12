import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SamlStrategy } from "@/server/auth/strategies/saml";
import { getProviderFullConfig } from "@/server/lib/auth-provider-config";

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
    };
  },
}));

vi.mock("@/server/lib/auth-provider-config", () => ({
  getProviderFullConfig: vi.fn(),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  },
}));

// Mock @node-saml/node-saml
const mockGetAuthorizeUrlAsync = vi.fn();
const mockValidatePostResponseAsync = vi.fn();
const mockGenerateServiceProviderMetadata = vi.fn();

vi.mock("@node-saml/node-saml", () => {
  return {
    SAML: class MockSAML {
      getAuthorizeUrlAsync = mockGetAuthorizeUrlAsync;
      validatePostResponseAsync = mockValidatePostResponseAsync;
      generateServiceProviderMetadata = mockGenerateServiceProviderMetadata;
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────

function mockConfig(overrides?: Record<string, unknown>) {
  vi.mocked(getProviderFullConfig).mockReturnValue({
    enabled: true,
    entityId: "https://idp.company.com/entity",
    ssoUrl: "https://idp.company.com/sso",
    certificate: "MIIDpDCCAoygAwIBAgIGAX...base64cert...",
    displayName: "Company SSO",
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("SamlStrategy", () => {
  let strategy: SamlStrategy;

  beforeEach(() => {
    vi.resetAllMocks();
    strategy = new SamlStrategy();
    mockConfig();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ── Initialize ───────────────────────────────────────────────────

  describe("initialize", () => {
    it("generates authorize URL via node-saml", async () => {
      mockGetAuthorizeUrlAsync.mockResolvedValueOnce(
        "https://idp.company.com/sso?SAMLRequest=encoded...",
      );

      const result = await strategy.initialize({ scope: "merchant" });

      expect(mockGetAuthorizeUrlAsync).toHaveBeenCalledTimes(1);
      // First arg is RelayState (hex string)
      const relayState = mockGetAuthorizeUrlAsync.mock.calls[0][0] as string;
      expect(relayState).toMatch(/^[a-f0-9]{32}$/);
      expect(result.data.url).toBe("https://idp.company.com/sso?SAMLRequest=encoded...");
    });

    it("throws when ssoUrl not configured", async () => {
      mockConfig({ ssoUrl: undefined });

      await expect(strategy.initialize({})).rejects.toThrow("SAML IdP not configured");
    });

    it("throws when certificate not configured", async () => {
      mockConfig({ certificate: undefined });

      await expect(strategy.initialize({})).rejects.toThrow("SAML IdP not configured");
    });
  });

  // ── Authenticate ─────────────────────────────────────────────────

  describe("authenticate", () => {
    async function initAndGetRelayState() {
      mockGetAuthorizeUrlAsync.mockResolvedValueOnce("https://idp.com/sso?SAMLRequest=...");
      await strategy.initialize({ scope: "merchant" });
      return mockGetAuthorizeUrlAsync.mock.calls[0][0] as string;
    }

    it("valid SAMLResponse + RelayState returns AuthIdentity", async () => {
      const relayState = await initAndGetRelayState();

      mockValidatePostResponseAsync.mockResolvedValueOnce({
        profile: {
          nameID: "user@company.com",
          nameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
          email: "user@company.com",
          firstName: "Alice",
          lastName: "Smith",
        },
      });

      const identity = await strategy.authenticate({
        SAMLResponse: "base64-encoded-response",
        RelayState: relayState,
      });

      expect(identity.provider).toBe("saml");
      expect(identity.providerAccountId).toBe("user@company.com");
      expect(identity.profile?.email).toBe("user@company.com");
      expect(identity.profile?.name).toBe("Alice Smith");
    });

    it("missing SAMLResponse throws", async () => {
      await expect(
        strategy.authenticate({ SAMLResponse: "", RelayState: "state" }),
      ).rejects.toThrow("SAML response is required");
    });

    it("invalid RelayState throws nonce_expired", async () => {
      mockValidatePostResponseAsync.mockResolvedValueOnce({
        profile: { nameID: "user@co.com" },
      });

      await expect(
        strategy.authenticate({
          SAMLResponse: "valid-response",
          RelayState: "invalid-relay-state",
        }),
      ).rejects.toThrow("Invalid or expired SAML state");
    });

    it("node-saml validation failure throws signature_invalid", async () => {
      const relayState = await initAndGetRelayState();

      mockValidatePostResponseAsync.mockRejectedValueOnce(new Error("Signature check failed"));

      await expect(
        strategy.authenticate({
          SAMLResponse: "bad-response",
          RelayState: relayState,
        }),
      ).rejects.toThrow("SAML assertion verification failed");
    });

    it("missing nameID throws provider_error", async () => {
      const relayState = await initAndGetRelayState();

      mockValidatePostResponseAsync.mockResolvedValueOnce({
        profile: { nameID: null },
      });

      await expect(
        strategy.authenticate({
          SAMLResponse: "response",
          RelayState: relayState,
        }),
      ).rejects.toThrow("SAML assertion missing nameID");
    });

    it("uses nameID as email when nameIDFormat is emailAddress", async () => {
      const relayState = await initAndGetRelayState();

      mockValidatePostResponseAsync.mockResolvedValueOnce({
        profile: {
          nameID: "alice@corp.com",
          nameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
      });

      const identity = await strategy.authenticate({
        SAMLResponse: "response",
        RelayState: relayState,
      });

      expect(identity.profile?.email).toBe("alice@corp.com");
    });

    it("uses displayName attribute when available", async () => {
      const relayState = await initAndGetRelayState();

      mockValidatePostResponseAsync.mockResolvedValueOnce({
        profile: {
          nameID: "uid123",
          displayName: "Dr. Alice Smith",
          firstName: "Alice",
          lastName: "Smith",
        },
      });

      const identity = await strategy.authenticate({
        SAMLResponse: "response",
        RelayState: relayState,
      });

      expect(identity.profile?.name).toBe("Dr. Alice Smith");
    });

    it("rejects without RelayState (CSRF protection)", async () => {
      // No RelayState — must be rejected to prevent CSRF attacks
      await expect(strategy.authenticate({ SAMLResponse: "valid-response" })).rejects.toThrow(
        "SAML RelayState is required",
      );
    });
  });

  // ── Metadata ─────────────────────────────────────────────────────

  describe("generateMetadata", () => {
    it("delegates to node-saml", () => {
      mockGenerateServiceProviderMetadata.mockReturnValueOnce(
        "<EntityDescriptor>...</EntityDescriptor>",
      );

      const xml = strategy.generateMetadata();

      expect(xml).toBe("<EntityDescriptor>...</EntityDescriptor>");
      expect(mockGenerateServiceProviderMetadata).toHaveBeenCalledWith(null, null);
    });
  });
});
