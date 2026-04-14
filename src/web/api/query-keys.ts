/**
 * Centralized TanStack Query key factory — single source of truth.
 *
 * Convention:
 * - Top-level arrays use domain prefix: "auth", "app", "admin", "public"
 * - Functions return readonly tuples for type safety
 */

export const queryKeys = {
  // ── Auth ────────────────────────────────────────────────────
  authProviders: () => ["auth", "providers"] as const,
  adminAuthProviders: () => ["admin-auth", "providers"] as const,

  // ── Public (no auth) ─────────────────────────────────────────
  publicAllowedTokens: () => ["public", "allowed-tokens"] as const,
  publicNetworks: () => ["public", "networks"] as const,

  // ── App ──────────────────────────────────────────────────────
  allowedTokens: () => ["app", "allowed-tokens"] as const,
  networks: () => ["app", "networks"] as const,
  payAgents: (params?: {
    id?: number;
    userName?: string;
    userUuid?: string;
    address?: string;
    page?: number;
  }) =>
    [
      "app",
      "pay-agents",
      params?.id ?? "all",
      params?.userName ?? "",
      params?.userUuid ?? "",
      params?.address ?? "",
      params?.page ?? 0,
    ] as const,
  payAgentsAll: () => ["app", "pay-agents"] as const,
  payAgentTransactions: (agentId: number) => ["app", "pay-agents", agentId, "txns"] as const,
  payAgentTxnsAll: () => ["app", "pay-agent-txns"] as const,
  payAgentTxnsList: (params?: {
    agentId?: number;
    type?: string;
    source?: string;
    page?: number;
  }) =>
    [
      "app",
      "pay-agent-txns",
      params?.agentId ?? "all",
      params?.type ?? "all",
      params?.source ?? "all",
      params?.page ?? 0,
    ] as const,
  payAgentResources: (agentId: number) => ["app", "pay-agents", agentId, "resources"] as const,
  notificationEvents: () => ["app", "notification-events"] as const,
  notificationConfigs: () => ["app", "notification-configs"] as const,
  notificationLogs: (params?: {
    event?: string;
    channel?: string;
    status?: string;
    page?: number;
  }) =>
    [
      "app",
      "notification-logs",
      params?.event ?? "all",
      params?.channel ?? "all",
      params?.status ?? "all",
      params?.page ?? 0,
    ] as const,
  apiKeys: () => ["app", "api-keys"] as const,
  fiatConfigs: () => ["app", "fiat-configs"] as const,
  topupOrdersAll: () => ["app", "topup-orders"] as const,
  topupOrders: (params?: { status?: string; page?: number }) =>
    ["app", "topup-orders", params?.status ?? "all", params?.page ?? 0] as const,
  adminWithdrawals: (params?: { status?: string; userUuid?: string; page?: number }) =>
    [
      "app",
      "admin-withdrawals",
      params?.status ?? "all",
      params?.userUuid ?? "",
      params?.page ?? 0,
    ] as const,
  adminWithdrawalsPendingCount: () => ["app", "admin-withdrawals-pending-count"] as const,
  webhookEvents: () => ["app", "webhook-events"] as const,
  webhooks: () => ["app", "webhooks"] as const,
  webhookDeliveriesAll: () => ["app", "webhook-deliveries"] as const,
  webhookDeliveries: (endpointId: number, page?: number) =>
    ["app", "webhook-deliveries", endpointId, page ?? 0] as const,
  announcements: () => ["app", "announcements"] as const,

  // ── Admin (real admin / back-office) ─────────────────────────
  adminAdmins: () => ["admin", "admins"] as const,
  adminUserDetail: (userId: number) => ["admin", "user-detail", userId] as const,
  adminUsers: (params?: {
    id?: number;
    uuid?: string;
    name?: string;
    email?: string;
    address?: string;
    page?: number;
  }) =>
    [
      "admin",
      "users",
      params?.id ?? 0,
      params?.uuid ?? "",
      params?.name ?? "",
      params?.email ?? "",
      params?.address ?? "",
      params?.page ?? 0,
    ] as const,
  adminAllowedTokens: () => ["admin", "allowed-tokens"] as const,
  adminKnownTokens: () => ["admin", "known-tokens"] as const,
  adminNetworks: () => ["admin", "networks"] as const,
  adminCircleNetworks: () => ["admin", "circle-networks"] as const,
  adminAuthProvidersConfig: () => ["admin", "auth-providers-config"] as const,
  adminNotificationProviders: () => ["admin", "notification-providers"] as const,
  adminAnnouncements: (params?: { page?: number }) => ["admin", "announcements", params] as const,
  adminGatewayConfig: () => ["admin", "gateway-config"] as const,
  adminGatewayStatus: () => ["admin", "gateway-status"] as const,

  // ── Key Providers ────────────────────────────────────────────
  keyProviders: () => ["app", "key-providers"] as const,
  keyProviderSummary: (providerId: number) => ["app", "key-provider-summary", providerId] as const,
  keyProviderDetail: (providerId: number) => ["app", "key-provider-detail", providerId] as const,
  keyProviderTxns: (providerId: number, limit: number, offset: number) =>
    ["app", "key-provider-txns", providerId, limit, offset] as const,

  // ── AI ───────────────────────────────────────────────────────
  aiProviders: () => ["app", "ai-providers"] as const,
  aiProviderUpstreams: (providerId: number) =>
    ["app", "ai-provider-upstreams", providerId] as const,
  aiUpstreamsOverview: (hours: number) => ["app", "ai-upstreams-overview", hours] as const,
  aiUpstreamRecent: (id: number, limit: number) =>
    ["app", "ai-upstream-recent", id, limit] as const,
  aiProviderModels: (providerId: number) => ["app", "ai-models", providerId] as const,
  aiKeys: () => ["app", "ai-keys"] as const,
  aiUsageSummary: () => ["app", "ai-usage-summary"] as const,
  aiUsageRecent: () => ["app", "ai-usage-recent"] as const,
  aiUsageDaily: (days: number) => ["app", "ai-usage-daily", days] as const,
  aiErrorOverview: (days: number) => ["app", "ai-error-overview", days] as const,
  aiErrorDaily: (days: number) => ["app", "ai-error-daily", days] as const,
  aiUsageByKey: () => ["app", "ai-usage-by-key"] as const,
  aiUsageSummaryByKey: (keyId: number) => ["app", "ai-usage-summary", keyId] as const,
  aiUsageRecentByKey: (keyId: number) => ["app", "ai-usage-recent", keyId] as const,
  aiUsageDailyByKey: (keyId: number, days: number) =>
    ["app", "ai-usage-daily", keyId, days] as const,
  aiUsageSummaryByUser: (userId: number) => ["app", "ai-usage-summary", "user", userId] as const,
  aiUsageRecentByUser: (userId: number) => ["app", "ai-usage-recent", "user", userId] as const,
  aiUsageDailyByUser: (userId: number, days: number) =>
    ["app", "ai-usage-daily", "user", userId, days] as const,
  aiUsageByKeyForUser: (userId: number) => ["app", "ai-usage-by-key", "user", userId] as const,
  aiLogs: (params?: {
    consumerKeyId?: number;
    modelId?: string;
    providerId?: string;
    statusClass?: "4xx" | "5xx";
    page?: number;
  }) =>
    [
      "app",
      "ai-logs",
      params?.consumerKeyId ?? "all",
      params?.modelId ?? "all",
      params?.providerId ?? "all",
      params?.statusClass ?? "all",
      params?.page ?? 0,
    ] as const,
  aiRequestLog: (requestId: string) => ["app", "ai-request-log", requestId] as const,
  aiRequestLogging: () => ["app", "ai-request-logging"] as const,
  aiDefaultMarkup: () => ["app", "ai-default-markup"] as const,
  relayKeys: (params?: { prefix?: string; userUuid?: string; page?: number }) =>
    ["app", "relay-keys", params?.prefix ?? "", params?.userUuid ?? "", params?.page ?? 0] as const,
  relayKeysAll: () => ["app", "relay-keys"] as const,
  aiDiscoverModels: (providerId: number) => ["app", "ai-discover-models", providerId] as const,

  // ── User Portal ─────────────────────────────────────────────
  userAuthProviders: () => ["user-auth", "providers"] as const,
  userProfile: () => ["user", "profile"] as const,
  userModels: () => ["user", "models"] as const,
  userKeys: () => ["user", "keys"] as const,
  userUsageSummary: () => ["user", "usage-summary"] as const,
  userUsageDaily: (days: number) => ["user", "usage-daily", days] as const,
  userErrorOverview: (days: number) => ["user", "error-overview", days] as const,
  userErrorDaily: (days: number) => ["user", "error-daily", days] as const,
  userLogs: (params?: { modelId?: string; statusClass?: "4xx" | "5xx"; page?: number }) =>
    [
      "user",
      "logs",
      params?.modelId ?? "all",
      params?.statusClass ?? "all",
      params?.page ?? 0,
    ] as const,
  userRequestLog: (requestId: string) => ["user", "request-log", requestId] as const,
  userAnnouncements: () => ["user", "announcements"] as const,

  // ── User Wallet ───────────────────────────────────────────────
  userWallet: () => ["user", "wallet"] as const,
  userWalletDepositInfo: () => ["user", "wallet-deposit"] as const,
  userWalletFiatConfigs: () => ["user", "wallet-fiat-configs"] as const,
  userWalletTransactions: (params?: Record<string, unknown>) =>
    ["user", "wallet-txns", params] as const,
  userWalletWithdrawals: (params?: Record<string, unknown>) =>
    ["user", "wallet-withdrawals", params] as const,
  userWalletTopupOrdersAll: () => ["user", "wallet-topup-orders"] as const,
  userWalletTopupOrders: (params?: Record<string, unknown>) =>
    ["user", "wallet-topup-orders", params] as const,
  userWalletTopupOrder: (orderId: number) =>
    ["user", "wallet-topup-orders", "detail", orderId] as const,
} as const;
