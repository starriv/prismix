/**
 * API mock helpers for E2E tests.
 * Uses page.route() to intercept /api/* calls at the browser level.
 *
 * IMPORTANT: Route patterns use URL predicates (not globs) to avoid matching
 * Vite module requests that contain "api" in their paths.
 */
import type { Page, Route } from "@playwright/test";

// ── Mock data matching Zod schemas in src/web/api/schemas.ts ──────

export const MOCK_ADMIN_USER = {
  id: 1,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  email: null as string | null,
  avatar: null as string | null,
  name: "Test Admin",
  uuid: "abcd1234",
  token: "USDC",
  network: "eip155:84532",
};

export const MOCK_AGENTS = [
  {
    id: 1,

    name: "Test Agent",
    description: "A test agent for E2E",
    type: "standard",
    balance: "10.00",
    status: "active",
    address: "0xbbbb111122223333444455556666777788889999",
    defaultMarkupPercent: 0,
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
  },
];

export const MOCK_RELAY_KEYS = [
  {
    id: 1,

    agentId: 1,
    name: "Production User",
    description: null,
    apiKeyPrefix: "ska_prod",
    markupPercent: null,
    rateLimitRpm: null,
    allowedModels: [],
    status: "active",
    expiresAt: null,
    lastUsedAt: "2026-03-20T10:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    createdAt: "2026-03-15T00:00:00.000Z",
  },
];

export const MOCK_SYSTEM_CONFIG = {
  address: MOCK_ADMIN_USER.address,
  token: "USDC",
  network: "eip155:84532",
};

export const MOCK_ALLOWED_TOKENS = [
  {
    id: 1,
    symbol: "USDC",
    network: "eip155:84532",
    contractAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const MOCK_NETWORKS = [
  {
    id: 1,
    chainId: 84532,
    networkId: "eip155:84532",
    name: "Base Sepolia",
    shortName: "basesep",
    explorerUrl: "https://sepolia.basescan.org",
    testnet: true,
    iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
    enabled: true,
    rpcUrl: "https://sepolia.base.org",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const mockNotificationEvent = (type: string) => {
  const key = type.replace(/\./g, "-");
  return {
    type,
    labelKey: `notif.event.${key}`,
    descriptionKey: `notif.event-desc.${key}`,
  };
};

export const MOCK_NOTIFICATION_EVENTS = {
  groups: [
    {
      key: "topup",
      labelKey: "notif.group.topup",
      events: [
        mockNotificationEvent("topup.requested"),
        mockNotificationEvent("topup.confirmed"),
        mockNotificationEvent("topup.rejected"),
        mockNotificationEvent("topup.expired"),
      ],
    },
    {
      key: "tx",
      labelKey: "notif.group.tx",
      events: [mockNotificationEvent("tx.large-amount"), mockNotificationEvent("tx.daily-summary")],
    },
    {
      key: "alert",
      labelKey: "notif.group.alert",
      events: [
        mockNotificationEvent("alert.circuit-breaker"),
        mockNotificationEvent("alert.upstream-timeout"),
        mockNotificationEvent("alert.error-spike"),
        mockNotificationEvent("alert.resource-down"),
      ],
    },
    {
      key: "supplier",
      labelKey: "notif.group.supplier",
      events: [
        mockNotificationEvent("supplier.disabled"),
        mockNotificationEvent("supplier.reenabled"),
      ],
    },
    {
      key: "system",
      labelKey: "notif.group.system",
      events: [mockNotificationEvent("system.announcement")],
    },
  ],
  enabledChannels: ["webhook", "email"],
};

export const MOCK_NOTIFICATION_CONFIGS = [
  {
    id: 1,

    channel: "webhook",
    label: "Ops Webhook",
    target: "https://hooks.example.com/ops",
    secret: "****",
    events: ["alert.circuit-breaker", "alert.upstream-timeout"],
    enabled: true,
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
  },
  {
    id: 2,

    channel: "email",
    label: "CEO Email",
    target: "ceo@example.com",
    secret: null,
    events: ["tx.large-amount"],
    enabled: true,
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
  },
];

export const MOCK_NOTIFICATION_LOGS = [
  {
    id: 1,

    configId: 1,
    channel: "webhook",
    event: "alert.circuit-breaker",
    target: "https://hooks.example.com/ops",
    payload: "{}",
    status: "sent",
    attempts: 1,
    lastError: null,
    createdAt: "2026-03-22T10:00:00.000Z",
    sentAt: "2026-03-22T10:00:01.000Z",
  },
  {
    id: 2,

    configId: 2,
    channel: "email",
    event: "tx.large-amount",
    target: "ceo@example.com",
    payload: "{}",
    status: "failed",
    attempts: 3,
    lastError: "SMTP connection refused",
    createdAt: "2026-03-22T11:00:00.000Z",
    sentAt: null,
  },
];

export const MOCK_ADMIN_NOTIFICATION_PROVIDERS = {
  email: {
    enabled: true,
    provider: "smtp",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpUser: "user@example.com",
    smtpPass: "****",
    fromAddress: "noreply@example.com",
    fromName: "Prismix",
  },
  telegram: { enabled: false, botToken: "" },
  webhook: { enabled: true },
  whatsapp: { enabled: false, apiToken: "", phoneNumberId: "" },
};

export const MOCK_ANNOUNCEMENTS = [
  {
    id: "ann_abc123",
    title: "Scheduled Maintenance",
    body: "System will be down for maintenance on Sunday 2am-4am UTC.",
    status: "sent",
    createdBy: "0xAdmin1",
    createdAt: "2026-03-20T10:00:00.000Z",
    sentAt: "2026-03-20T10:05:00.000Z",
  },
  {
    id: "ann_def456",
    title: "New Feature: Webhook Notifications",
    body: "We have released webhook notification support. Configure it in Settings > Notifications.",
    status: "draft",
    createdBy: "0xAdmin1",
    createdAt: "2026-03-22T08:00:00.000Z",
    sentAt: null,
  },
];

export const MOCK_WEBHOOK_ENDPOINTS = [
  {
    id: 1,

    url: "https://api.example.com/webhooks",
    description: "Production webhook",
    secret: "whsec_****0123",
    events: ["tx.settled", "tx.settle-failed"],
    status: "active",
    failureCount: 0,
    lastFailureAt: null,
    updatedAt: "2026-03-20T00:00:00.000Z",
    createdAt: "2026-03-20T00:00:00.000Z",
  },
];

export const MOCK_WEBHOOK_EVENTS = {
  groups: [
    { key: "tx", events: ["tx.settled", "tx.settle-failed", "tx.verified", "tx.verify-failed"] },
    { key: "gateway", events: ["gateway.upstream-timeout", "gateway.upstream-error"] },
    { key: "resource", events: ["resource.created", "resource.updated", "resource.deleted"] },
  ],
};

export const MOCK_WEBHOOK_DELIVERIES = {
  items: [
    {
      id: 1,
      endpointId: 1,

      eventId: "evt_test-uuid-123",
      eventType: "tx.settled",
      payload: '{"id":"evt_test-uuid-123","type":"tx.settled","data":{}}',
      status: "success",
      attempts: 1,
      nextRetryAt: null,
      responseStatus: 200,
      responseBody: "ok",
      latencyMs: 42,
      lastError: null,
      createdAt: "2026-03-22T10:00:00.000Z",
    },
  ],
  total: 1,
};

export const MOCK_AI_PROVIDERS = [
  {
    id: 1,
    providerId: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    authType: "bearer",
    authConfig: {},
    enabled: true,
    loadBalanceStrategy: "round-robin",
    upstreamRoutingStrategy: "priority",
    iconUrl: null,
    upstreamCount: 1,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

export const MOCK_AI_UPSTREAMS = [
  {
    id: 10,
    upstreamId: "openrouter-1",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    kind: "openrouter",
    enabled: true,
    metadata: {},
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

export const MOCK_AI_UPSTREAM_ASSIGNMENTS = [
  {
    id: 100,
    providerId: 1,
    upstream: MOCK_AI_UPSTREAMS[0],
    priority: 100,
    weight: 1,
    enabled: true,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

export const MOCK_AI_KEYS = [
  {
    id: 1,
    providerId: 1,
    upstreamId: null,
    ownerId: null,
    name: "Official Key",
    keyPrefix: "sk-offi",
    weight: 1,
    enabled: true,
    providerName: "OpenAI",
    ownerName: null,
    upstreamName: null,
    upstreamSlug: null,
    lastUsedAt: "2026-03-20T10:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: 2,
    providerId: 1,
    upstreamId: 10,
    ownerId: null,
    name: "OpenRouter Key",
    keyPrefix: "sk-open",
    weight: 1,
    enabled: true,
    providerName: "OpenAI",
    ownerName: null,
    upstreamName: "OpenRouter",
    upstreamSlug: "openrouter-1",
    lastUsedAt: null,
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
  },
];

export const MOCK_KEY_PROVIDERS: { id: number; name: string; status: string }[] = [];

// ── Helpers ───────────────────────────────────────────────────────

/** Check if a URL is an app API request (not a Vite module request) */
function isApiPath(url: URL, pathPrefix: string): boolean {
  return url.pathname.startsWith(pathPrefix);
}

function json(data: unknown, status = 200): Parameters<Route["fulfill"]>[0] {
  return { status, contentType: "application/json", body: JSON.stringify({ data }) };
}

// ── MockApi class ─────────────────────────────────────────────────

export class MockApi {
  constructor(public page: Page) {}

  /** Set up all default API mocks for an authenticated admin session */
  async setupDefaults() {
    await this.mockAuthMe();
    await this.mockAuthRefresh();
    await this.mockAuthLogout();
    await this.mockSystemConfig();
    await this.mockAllowedTokens();
    await this.mockNetworks();
    await this.mockRateLimits();
    await this.mockAgents();
    await this.mockRelayKeys();
    await this.mockNotifications();
    await this.mockAnnouncements();
    await this.mockWebhooks();
  }

  async mockAuthMe(admin = MOCK_ADMIN_USER) {
    await this.page.route(
      (url) => isApiPath(url, "/api/auth/me"),
      (route) => route.fulfill(json({ admin })),
    );
  }

  async mockAuthProviders(providers: string[] = ["siwe"]) {
    await this.page.route(
      (url) => isApiPath(url, "/api/auth/providers"),
      (route) => route.fulfill(json({ providers })),
    );
  }

  async mockAuthAuthenticate(admin = MOCK_ADMIN_USER) {
    await this.page.route(
      (url) => url.pathname.includes("/authenticate"),
      (route) =>
        route.fulfill(
          json({ token: "e2e-test-jwt-token", refreshToken: "e2e-test-refresh-token", admin }),
        ),
    );
  }

  async mockAuthRefresh() {
    await this.page.route(
      (url) => isApiPath(url, "/api/auth/refresh"),
      (route) => route.fulfill(json({ token: "refreshed-token" })),
    );
  }

  async mockAuthLogout() {
    await this.page.route(
      (url) => isApiPath(url, "/api/auth/logout"),
      (route) => route.fulfill(json(null)),
    );
  }

  async mockSystemConfig() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/system-config"),
      (route) => {
        if (route.request().method() === "PUT") {
          return route.fulfill(json(MOCK_SYSTEM_CONFIG));
        }
        return route.fulfill(json(MOCK_SYSTEM_CONFIG));
      },
    );
  }

  async mockAllowedTokens() {
    await this.page.route(
      (url) =>
        isApiPath(url, "/api/auth/allowed-tokens") || isApiPath(url, "/api/admin/allowed-tokens"),
      (route) => route.fulfill(json(MOCK_ALLOWED_TOKENS)),
    );
  }

  async mockNetworks() {
    await this.page.route(
      (url) => isApiPath(url, "/api/auth/networks") || isApiPath(url, "/api/admin/networks"),
      (route) => route.fulfill(json(MOCK_NETWORKS)),
    );
  }

  async mockRateLimits() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/rate-limits"),
      (route) => route.fulfill(json([])),
    );
  }

  async mockAgents() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/pay-agents"),
      (route) => {
        const method = route.request().method();
        if (method === "POST") {
          return route.fulfill(
            json(
              {
                ...MOCK_AGENTS[0],
                id: 99,
              },
              201,
            ),
          );
        }
        if (method === "PUT") {
          return route.fulfill(json({ ...MOCK_AGENTS[0], status: "suspended" }));
        }
        if (method === "DELETE") {
          return route.fulfill(json({ success: true }));
        }
        return route.fulfill(json(MOCK_AGENTS));
      },
    );
  }

  async mockRelayKeys() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/relay-keys"),
      (route) => {
        const method = route.request().method();
        if (method === "POST") {
          return route.fulfill(
            json(
              {
                ...MOCK_RELAY_KEYS[0],
                id: 99,
                apiKey: "ska_test_full_api_key_shown_once_abc123",
              },
              201,
            ),
          );
        }
        if (method === "DELETE") {
          return route.fulfill(
            json({
              success: true,
              agent: { id: 1, name: "[AI] Production User", balance: "10.00" },
            }),
          );
        }
        return route.fulfill(json(MOCK_RELAY_KEYS));
      },
    );
  }

  async mockNotifications() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/notification-events"),
      (route) => route.fulfill(json(MOCK_NOTIFICATION_EVENTS)),
    );
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/notification-configs"),
      (route) => {
        const method = route.request().method();
        if (method === "POST")
          return route.fulfill(
            json({ ...MOCK_NOTIFICATION_CONFIGS[0], id: 99, label: "New Channel" }, 201),
          );
        if (method === "PUT") return route.fulfill(json(MOCK_NOTIFICATION_CONFIGS[0]));
        if (method === "DELETE") return route.fulfill(json({ success: true }));
        return route.fulfill(json(MOCK_NOTIFICATION_CONFIGS));
      },
    );
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/notification-logs"),
      (route) => route.fulfill(json(MOCK_NOTIFICATION_LOGS)),
    );
  }

  async mockAnnouncements(announcements = MOCK_ANNOUNCEMENTS.filter((a) => a.status === "sent")) {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/announcements"),
      (route) => route.fulfill(json(announcements)),
    );
  }

  async mockAdminAnnouncements() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/announcements"),
      (route) => {
        const method = route.request().method();
        if (method === "POST") return route.fulfill(json(MOCK_ANNOUNCEMENTS[1]));
        if (method === "PUT") return route.fulfill(json(MOCK_ANNOUNCEMENTS[1]));
        if (method === "DELETE") return route.fulfill(json({ success: true }));
        return route.fulfill(json(MOCK_ANNOUNCEMENTS));
      },
    );
  }

  async mockWebhooks(endpoints = MOCK_WEBHOOK_ENDPOINTS) {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/webhooks/events"),
      (route) => route.fulfill(json(MOCK_WEBHOOK_EVENTS)),
    );
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/webhooks") && !url.pathname.includes("/events"),
      (route) => {
        const method = route.request().method();
        const pathname = new URL(route.request().url()).pathname;
        // Deliveries endpoint: /api/admin/webhooks/:id/deliveries
        if (pathname.match(/\/webhooks\/\d+\/deliveries/)) {
          return route.fulfill(json(MOCK_WEBHOOK_DELIVERIES));
        }
        // Test endpoint: /api/admin/webhooks/:id/test
        if (pathname.match(/\/webhooks\/\d+\/test/) && method === "POST") {
          return route.fulfill(json({ success: true, deliveryId: 99 }));
        }
        // Rotate secret: /api/admin/webhooks/:id/rotate
        if (pathname.match(/\/webhooks\/\d+\/rotate/) && method === "POST") {
          return route.fulfill(
            json({ ...MOCK_WEBHOOK_ENDPOINTS[0], secret: "whsec_new_rotated_secret_value" }),
          );
        }
        // Single endpoint operations: /api/admin/webhooks/:id
        if (pathname.match(/\/webhooks\/\d+$/)) {
          if (method === "DELETE") return route.fulfill(json({ success: true }));
          if (method === "PUT")
            return route.fulfill(json(endpoints[0] ?? MOCK_WEBHOOK_ENDPOINTS[0]));
          return route.fulfill(json(endpoints[0] ?? MOCK_WEBHOOK_ENDPOINTS[0]));
        }
        // List / create
        if (method === "POST") {
          return route.fulfill(
            json(
              {
                ...MOCK_WEBHOOK_ENDPOINTS[0],
                id: 2,
                secret: "whsec_dGVzdF9zZWNyZXRfZm9yX2UyZV90ZXN0",
              },
              201,
            ),
          );
        }
        return route.fulfill(json(endpoints)); // GET list
      },
    );
  }

  async mockAdminNotificationProviders() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/notification-providers"),
      (route) => {
        if (route.request().method() === "PUT") return route.fulfill(json({ success: true }));
        return route.fulfill(json(MOCK_ADMIN_NOTIFICATION_PROVIDERS));
      },
    );
  }

  async mockAdminNetworks() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/networks"),
      (route) => {
        const method = route.request().method();
        if (method === "PUT") {
          const updated = { ...MOCK_NETWORKS[0], rpcUrl: "https://custom-rpc.example.com" };
          return route.fulfill(json(updated));
        }
        if (method === "DELETE") return route.fulfill(json({ success: true }));
        return route.fulfill(json(MOCK_NETWORKS));
      },
    );
  }

  async mockAiProviders() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/ai/providers"),
      (route) => {
        const pathname = new URL(route.request().url()).pathname;
        // Provider upstream assignments: /api/admin/ai/providers/:id/upstreams
        if (pathname.match(/\/providers\/\d+\/upstreams/)) {
          return route.fulfill(json(MOCK_AI_UPSTREAM_ASSIGNMENTS));
        }
        return route.fulfill(json(MOCK_AI_PROVIDERS));
      },
    );
  }

  async mockAiUpstreams() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/ai/upstreams"),
      (route) => route.fulfill(json(MOCK_AI_UPSTREAMS)),
    );
  }

  async mockAiKeys() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/ai/keys"),
      (route) => {
        const method = route.request().method();
        if (method === "POST") return route.fulfill(json({ ...MOCK_AI_KEYS[0], id: 99 }, 201));
        if (method === "DELETE") return route.fulfill(json({ success: true }));
        return route.fulfill(json(MOCK_AI_KEYS));
      },
    );
  }

  async mockKeyProviders() {
    await this.page.route(
      (url) => isApiPath(url, "/api/admin/key-providers") && !url.pathname.includes("/usage"),
      (route) => route.fulfill(json(MOCK_KEY_PROVIDERS)),
    );
  }
}
