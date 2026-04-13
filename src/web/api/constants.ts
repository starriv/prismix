/**
 * All API endpoint paths — single source of truth.
 * Grouped by domain (auth, app, admin).
 */

/** Global default page size for all paginated lists. */
export const DEFAULT_PAGE_SIZE = 10;

// ── Public Auth (strategy-based) ─────────────────────────────────
export const API_AUTH_PROVIDERS = "/api/auth/providers";
export const apiAuthInitialize = (provider: string) => `/api/auth/${provider}/initialize`;
export const apiAuthAuthenticate = (provider: string) => `/api/auth/${provider}/authenticate`;
export const apiAuthRegister = (provider: string) => `/api/auth/${provider}/register`;
export const API_AUTH_EXCHANGE = "/api/auth/exchange";
export const API_AUTH_ME = "/api/auth/me";
export const API_AUTH_LOGOUT = "/api/auth/logout";
export const API_AUTH_REFRESH = "/api/auth/refresh";
export const API_AUTH_ALLOWED_TOKENS = "/api/auth/allowed-tokens";
export const API_AUTH_NETWORKS = "/api/auth/networks";

// ── Admin Auth (strategy-based) ──────────────────────────────────
export const API_ADMIN_AUTH_PROVIDERS = "/api/admin-auth/providers";
export const apiAdminAuthInitialize = (provider: string) =>
  `/api/admin-auth/${provider}/initialize`;
export const apiAdminAuthAuthenticate = (provider: string) =>
  `/api/admin-auth/${provider}/authenticate`;
export const apiAdminAuthRegister = (provider: string) => `/api/admin-auth/${provider}/register`;
export const API_ADMIN_AUTH_EXCHANGE = "/api/admin-auth/exchange";
export const API_ADMIN_AUTH_ME = "/api/admin-auth/me";
export const API_ADMIN_AUTH_LOGOUT = "/api/admin-auth/logout";
export const API_ADMIN_AUTH_REFRESH = "/api/admin-auth/refresh";

// ── Tokens, Networks & Pay Agents ────────────────────────────────
export const API_ALLOWED_TOKENS = "/api/admin/allowed-tokens";
export const API_NETWORKS = "/api/admin/networks";
export const API_PAY_AGENTS = "/api/admin/pay-agents";
export const apiPayAgentDetail = (id: number) => `/api/admin/pay-agents/${id}`;
export const apiPayAgentTopup = (id: number) => `/api/admin/pay-agents/${id}/topup`;
export const apiPayAgentTxns = (id: number) => `/api/admin/pay-agents/${id}/txns`;
export const apiPayAgentResources = (id: number) => `/api/admin/pay-agents/${id}/resources`;
export const apiPayAgentManualTopup = (id: number) => `/api/admin/pay-agents/${id}/manual-topup`;
export const apiPayAgentDebit = (id: number) => `/api/admin/pay-agents/${id}/debit`;
export const apiPayAgentSync = (id: number) => `/api/admin/pay-agents/${id}/sync`;
export const API_PAY_AGENT_TXNS = "/api/admin/pay-agents/txns";
export const API_PAY_AGENT_SYNC_ALL = "/api/admin/pay-agents/sync-all";
// ── Withdrawals ──────────────────────────────────────────────
export const API_ADMIN_WITHDRAWALS = "/api/admin/wallet/withdrawals";
export const API_ADMIN_WITHDRAWALS_PENDING_COUNT = "/api/admin/wallet/withdrawals/count";
export const apiAdminWithdrawApprove = (id: number) =>
  `/api/admin/wallet/withdrawals/${id}/approve`;
export const apiAdminWithdrawReject = (id: number) => `/api/admin/wallet/withdrawals/${id}/reject`;
// ── Notifications ──────────────────────────────────────────────
export const API_NOTIFICATION_EVENTS = "/api/admin/notification-events";
export const API_NOTIFICATION_CONFIGS = "/api/admin/notification-configs";
export const apiNotificationConfigDetail = (id: number) => `/api/admin/notification-configs/${id}`;
export const apiNotificationConfigTest = (id: number) =>
  `/api/admin/notification-configs/${id}/test`;
export const API_NOTIFICATION_LOGS = "/api/admin/notification-logs";

// ── API Keys ────────────────────────────────────────────────
export const API_API_KEYS = "/api/admin/api-keys";
export const apiApiKeyDetail = (id: number) => `/api/admin/api-keys/${id}`;
export const apiApiKeyRevoke = (id: number) => `/api/admin/api-keys/${id}/revoke`;
export const apiApiKeyRotate = (id: number) => `/api/admin/api-keys/${id}/rotate`;

// ── Fiat Configs ──────────────────────────────────────────────
export const API_FIAT_CONFIGS = "/api/admin/fiat-configs";
export const apiFiatConfigDetail = (id: number) => `/api/admin/fiat-configs/${id}`;
export const API_FIAT_CONFIGS_REORDER = "/api/admin/fiat-configs/reorder";

// ── Top-up Orders ──────────────────────────────────────────────
export const API_TOPUP_ORDERS = "/api/admin/topup-orders";
export const apiTopupOrderDetail = (id: number) => `/api/admin/topup-orders/${id}`;
export const apiTopupOrderConfirm = (id: number) => `/api/admin/topup-orders/${id}/confirm`;
export const apiTopupOrderReject = (id: number) => `/api/admin/topup-orders/${id}/reject`;

// ── Webhooks ────────────────────────────────────────────────
export const API_WEBHOOKS = "/api/admin/webhooks";
export const API_WEBHOOK_EVENTS = "/api/admin/webhooks/events";
export const apiWebhookDetail = (id: number) => `/api/admin/webhooks/${id}`;
export const apiWebhookTest = (id: number) => `/api/admin/webhooks/${id}/test`;
export const apiWebhookRotateSecret = (id: number) => `/api/admin/webhooks/${id}/rotate-secret`;
export const apiWebhookDeliveries = (id: number) => `/api/admin/webhooks/${id}/deliveries`;
export const apiWebhookDeliveryRetry = (endpointId: number, deliveryId: number) =>
  `/api/admin/webhooks/${endpointId}/deliveries/${deliveryId}/retry`;

// ── Announcements ─────────────────────────────────────────────
export const API_ANNOUNCEMENTS = "/api/admin/announcements";

// ── Admin (real admin / back-office) ────────────────────────────
export const API_ADMIN_ADMINS = "/api/admin/admins";
export const API_ADMIN_AUTH_PROVIDERS_CONFIG = "/api/admin/auth-providers";
export const API_ADMIN_SSO_DISCOVER_SAML = "/api/admin/sso/discover-saml";
export const API_ADMIN_USERS = "/api/admin/users";
/** @deprecated Use `API_ADMIN_USERS` instead */
export const API_ADMIN_MERCHANTS = API_ADMIN_USERS;
export const apiAdminUserDetail = (id: number) => `/api/admin/users/${id}`;
export const apiAdminUserDisable = (id: number) => `/api/admin/users/${id}/disable`;
export const apiAdminUserEnable = (id: number) => `/api/admin/users/${id}/enable`;
export const apiAdminUserCredit = (id: number) => `/api/admin/users/${id}/credit`;
export const apiAdminUserCreateAgent = (id: number) => `/api/admin/users/${id}/create-agent`;
export const API_ADMIN_ALLOWED_TOKENS = "/api/admin/allowed-tokens";
export const API_ADMIN_KNOWN_TOKENS = "/api/admin/known-tokens";
export const API_ADMIN_NETWORKS = "/api/admin/networks";
export const API_ADMIN_CIRCLE_NETWORKS = "/api/admin/circle-networks";
export const API_ADMIN_NOTIFICATION_PROVIDERS = "/api/admin/notification-providers";
export const API_ADMIN_ANNOUNCEMENTS = "/api/admin/announcements";
export const apiAdminAnnouncementDetail = (id: string) => `/api/admin/announcements/${id}`;
export const apiAdminAnnouncementSend = (id: string) => `/api/admin/announcements/${id}/send`;

// ── Key Providers (号池供应商) ────────────────────────────────────
export const API_KEY_PROVIDERS = "/api/admin/key-providers";
export const apiKeyProviderDetail = (id: number) => `/api/admin/key-providers/${id}`;
export const apiKeyProviderSummary = (id: number) => `/api/admin/key-providers/${id}/summary`;
export const apiKeyProviderAdjust = (id: number) => `/api/admin/key-providers/${id}/adjust`;
export const API_KEY_PROVIDER_TXNS = "/api/admin/key-providers/txns";

// ── AI ──────────────────────────────────────────────────────────
export const API_AI_PROVIDERS = "/api/admin/ai/providers";
export const apiAiProviderDetail = (id: number) => `/api/admin/ai/providers/${id}`;
export const apiAiProviderUpstreams = (id: number) => `/api/admin/ai/providers/${id}/upstreams`;
export const apiAiProviderUpstreamDetail = (providerId: number, upstreamId: number) =>
  `/api/admin/ai/providers/${providerId}/upstreams/${upstreamId}`;
export const API_AI_UPSTREAMS_OVERVIEW = "/api/admin/ai/upstreams/overview";
export const apiAiUpstreamRecent = (id: number) => `/api/admin/ai/upstreams/${id}/recent`;
export const apiAiProviderModels = (id: number) => `/api/admin/ai/providers/${id}/models`;
export const apiAiProviderModelsBatch = (id: number) =>
  `/api/admin/ai/providers/${id}/models/batch`;
export const apiAiSyncPricesPreview = (id: number) =>
  `/api/admin/ai/providers/${id}/models/sync-prices/preview`;
export const apiAiSyncPricesApply = (id: number) =>
  `/api/admin/ai/providers/${id}/models/sync-prices/apply`;
export const apiAiModelDetail = (id: number) => `/api/admin/ai/models/${id}`;
export const API_AI_MODELS_BATCH_DELETE = "/api/admin/ai/models/batch-delete";
export const apiAiDiscoverModels = (id: number) => `/api/admin/ai/providers/${id}/discover-models`;
export const API_AI_KEYS = "/api/admin/ai/keys";
export const apiAiKeyDetail = (id: number) => `/api/admin/ai/keys/${id}`;
export const apiAiKeyTest = (id: number) => `/api/admin/ai/keys/${id}/test`;
export const API_AI_USAGE_SUMMARY = "/api/admin/ai/usage/summary";
export const API_AI_USAGE_RECENT = "/api/admin/ai/usage/recent";
export const API_AI_USAGE_DAILY = "/api/admin/ai/usage/daily";
export const API_AI_ERROR_OVERVIEW = "/api/admin/ai/usage/error-overview";
export const API_AI_ERROR_DAILY = "/api/admin/ai/usage/error-daily";
export const API_AI_USAGE_BY_KEY = "/api/admin/ai/usage/by-key";
export const apiAiUsageRequest = (requestId: string) => `/api/admin/ai/usage/request/${requestId}`;
export const API_AI_REQUEST_LOGGING = "/api/admin/ai/settings/request-logging";
export const API_AI_DEFAULT_MARKUP = "/api/admin/ai/settings/default-markup";

// ── Gateway Config ───────────────────────────────────────────────
export const API_ADMIN_GATEWAY_CONFIG = "/api/admin/gateway-config";
export const API_ADMIN_GATEWAY_STATUS = "/api/admin/gateway-status";

// ── Relay Consumer Keys ───────────────────────────────────────────
export const API_RELAY_KEYS = "/api/admin/relay-keys";
export const apiRelayKeyDetail = (id: number) => `/api/admin/relay-keys/${id}`;
export const apiRelayKeyReveal = (id: number) => `/api/admin/relay-keys/${id}/reveal`;
export const apiRelayKeyRotate = (id: number) => `/api/admin/relay-keys/${id}/rotate`;

// ── User Portal ────────────────────────────────────────────────
export const API_USER_PROFILE = "/api/user/profile";
export const API_USER_MODELS = "/api/user/models";
export const API_USER_KEYS = "/api/user/keys";
export const apiUserKeyDetail = (id: number) => `/api/user/keys/${id}`;
export const apiUserKeyUsage = (id: number) => `/api/user/keys/${id}/usage`;
export const API_USER_USAGE_SUMMARY = "/api/user/usage/summary";
export const API_USER_USAGE_DAILY = "/api/user/usage/daily";
export const API_USER_ERROR_OVERVIEW = "/api/user/usage/error-overview";
export const API_USER_ERROR_DAILY = "/api/user/usage/error-daily";
export const API_USER_LOGS = "/api/user/logs";
export const apiUserRequestLog = (requestId: string) => `/api/user/logs/request/${requestId}`;

// ── User Announcements ────────────────────────────────────────
export const API_USER_ANNOUNCEMENTS = "/api/user/announcements";

// ── User Wallet ────────────────────────────────────────────────
export const API_USER_WALLET = "/api/user/wallet";
export const API_USER_WALLET_DEPOSIT_INFO = "/api/user/wallet/deposit-info";
export const API_USER_WALLET_DEPOSIT_VERIFY = "/api/user/wallet/deposit/verify";
export const API_USER_WALLET_TRANSACTIONS = "/api/user/wallet/transactions";
export const API_USER_WALLET_WITHDRAW = "/api/user/wallet/withdraw";
export const API_USER_WALLET_WITHDRAWALS = "/api/user/wallet/withdrawals";
