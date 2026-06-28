import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateUuidV7 } from "@/server/lib/uuid";

// ── Users (end consumers) ─────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    uuid: text("uuid")
      .notNull()
      .$defaultFn(() => generateUuidV7()),
    email: text("email").unique(),
    name: text("name").notNull(),
    avatar: text("avatar"),
    address: text("address").unique(), // optional — Web3 users have a wallet
    agentId: integer("agent_id").references(() => payAgents.id, { onDelete: "set null" }), // user's single wallet (pay agent)
    status: integer("status").notNull().default(1), // 1=active, 2=disabled
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("users_uuid_unique").on(t.uuid)],
);

// ── Admins ────────────────────────────────────────────────────────────

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  address: text("address").unique(), // optional — Web2 admins have no wallet
  name: text("name").notNull(),
  email: text("email"), // optional — OAuth / credentials bring this
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── Pay agents (wallet agents for AI billing) ────────────────────────

export const payAgents = pgTable("pay_agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  address: text("address"), // wallet address for x402 signing (null for ledger-only agents)
  privateKey: text("private_key"), // AES-encrypted private key (null for ledger-only agents)
  type: text("type").notNull().default("standard"), // "standard" | "ledger"
  balance: text("balance").notNull().default("0"), // USDC ledger balance
  status: text("status").notNull().default("active"), // "active" | "suspended"
  perPayLimit: text("per_pay_limit"), // max USDC per single payment (null = unlimited)
  dailyLimit: text("daily_limit"), // max USDC per day (null = unlimited)
  monthlyLimit: text("monthly_limit"), // max USDC per month (null = unlimited)
  defaultMarkupPercent: real("default_markup_percent"), // null = inherit global default; explicit value = override (0-1000)
  lastSyncBlock: integer("last_sync_block").notNull().default(0), // last scanned block for on-chain sync
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── Pay agent transactions (high-frequency append, NO FK) ─────────────

export const payAgentTransactions = pgTable(
  "pay_agent_transactions",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(), // no FK — high-frequency append-only table
    userId: integer("user_id"), // no FK — set when consumer (user) is billed
    type: text("type").notNull(), // "top_up" | "payment" | "ai_usage" | "withdraw" | "admin_debit"
    amount: text("amount").notNull(), // USDC amount
    balanceBefore: text("balance_before").notNull(),
    balanceAfter: text("balance_after").notNull(),
    referenceType: text("reference_type"), // "top_up_order" | "x402_payment"
    referenceId: integer("reference_id"),
    description: text("description"),
    txHash: text("tx_hash"), // on-chain tx hash for verified top-ups (nullable — payment/refund have none)
    network: text("network"), // CAIP-2 network id (e.g. "eip155:84532")
    source: text("source").notNull().default("platform"), // "platform" | "on_chain"
    consumerKeyId: integer("consumer_key_id"), // nullable — set for AI usage billing
    modelId: text("model_id"), // nullable — AI model used
    tokens: integer("tokens"), // nullable — total token count for AI usage
    requestId: text("request_id"), // nullable — links to ai_usage_logs.request_id for drill-down
    upstreamCost: text("upstream_cost"), // nullable — raw cost before markup (AI usage only)
    markupPercent: real("markup_percent"), // nullable — markup % applied at billing time (AI usage only)
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_pay_agent_transactions_agent_id").on(t.agentId),
    index("idx_pay_agent_transactions_created_at").on(t.createdAt),
    uniqueIndex("uq_pay_agent_transactions_tx_hash").on(t.txHash),
    index("idx_pay_agent_txns_consumer_key").on(t.consumerKeyId),
    index("idx_pay_agent_txns_request_id").on(t.requestId),
    index("idx_pay_agent_txns_user_id").on(t.userId),
  ],
);

// ── Global settings (key-value config) ────────────────────────────────

export const globalSettings = pgTable("global_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── Supported networks ────────────────────────────────────────────────

export const supportedNetworks = pgTable("supported_networks", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id").notNull().unique(),
  networkId: text("network_id").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  explorerUrl: text("explorer_url").notNull(),
  testnet: boolean("testnet").notNull().default(false),
  iconUrl: text("icon_url").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  rpcUrl: text("rpc_url").notNull().default(""),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── Allowed tokens ────────────────────────────────────────────────────

export const allowedTokens = pgTable(
  "allowed_tokens",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    network: text("network").notNull(),
    contractAddress: text("contract_address").notNull().default(""),
    decimals: integer("decimals").notNull().default(6),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [unique().on(t.symbol, t.network)],
);

// ── Refresh tokens ────────────────────────────────────────────────────

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: integer("user_id").notNull(),
    role: text("role").notNull(), // "admin" | "user"
    address: text("address").notNull().default(""), // optional — Web2 users store empty string
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_refresh_tokens_user_role").on(t.userId, t.role),
    index("idx_refresh_tokens_expires_at").on(t.expiresAt),
  ],
);

// ── Identities (auth provider → user mapping) ─────────────────────────

export const identities = pgTable(
  "identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(), // no FK — polymorphic (user or admin)
    userRole: text("user_role").notNull().default("user"), // "user" | "admin"
    provider: text("provider").notNull(), // "siwe" | "credentials" | "google" | "github"
    providerAccountId: text("provider_account_id").notNull(), // address / email / oauth-sub
    passwordHash: text("password_hash"), // only for credentials strategy
    profileData: text("profile_data"), // JSON: { email, name, avatar, ... }
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.provider, t.providerAccountId, t.userRole),
    index("idx_identities_user").on(t.userId, t.userRole),
    index("idx_identities_provider").on(t.provider, t.providerAccountId),
  ],
);

// ── Notification configs (system-level) ───────────────────────────────

export const notificationConfigs = pgTable("notification_configs", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(), // email | telegram | webhook | whatsapp
  label: text("label").notNull().default(""),
  target: text("target").notNull(),
  secret: text("secret"), // AES-encrypted webhook secret (optional)
  events: text("events").notNull(), // JSON array
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("active"), // active | disabled (system-deactivated)
  failureCount: integer("failure_count").notNull().default(0),
  lastFailureAt: timestamp("last_failure_at"),
  disabledReason: text("disabled_reason"),
  disabledAt: timestamp("disabled_at"),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── Notification logs (high-frequency append, NO FK) ──────────────────

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: serial("id").primaryKey(),
    configId: integer("config_id"),
    channel: text("channel").notNull(),
    event: text("event").notNull(),
    target: text("target").notNull(),
    payload: text("payload").notNull(),
    dedupeKey: text("dedupe_key"), // deterministic key for idempotent delivery
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_notification_logs_status").on(t.status),
    index("idx_notification_logs_created_at").on(t.createdAt),
    uniqueIndex("uq_notification_logs_dedupe_key").on(t.dedupeKey),
  ],
);

// ── Top-up orders (management table, FK + CASCADE) ────────────────────

export const topUpOrders = pgTable(
  "top_up_orders",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => payAgents.id, { onDelete: "cascade" }),
    amount: text("amount").notNull(), // requested USDC amount
    fiatAmount: text("fiat_amount"), // corresponding fiat amount (admin fills manually)
    fiatCurrency: text("fiat_currency").notNull().default("USD"),
    type: text("type").notNull().default("crypto"), // crypto | fiat
    fiatConfigId: integer("fiat_config_id"),
    status: text("status").notNull().default("pending"), // pending | confirmed | rejected | expired
    paymentMethod: text("payment_method"), // fiat_config.method chosen by user
    paymentProof: text("payment_proof"), // user-provided proof
    adminNote: text("admin_note"), // admin note on confirm/reject
    network: text("network"), // CAIP-2 network id for crypto top-ups (e.g. "eip155:84532")
    toAddress: text("to_address"), // agent wallet address (deposit target)
    txHash: text("tx_hash"), // matched on-chain tx hash (set on confirmation)
    confirmedAt: timestamp("confirmed_at"),
    expiredAt: timestamp("expired_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_top_up_orders_agent_id").on(t.agentId),
    index("idx_top_up_orders_status").on(t.status),
  ],
);

// ── Withdraw orders (management table, FK + CASCADE) ────────────────

export const withdrawOrders = pgTable(
  "withdraw_orders",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => payAgents.id, { onDelete: "cascade" }),
    userId: integer("user_id"), // user who requested the withdrawal
    type: text("type").notNull().default("crypto"), // crypto | fiat
    fiatConfigId: integer("fiat_config_id"),
    paymentMethod: text("payment_method"), // fiat_config.method chosen by user
    userNote: text("user_note"), // user-provided note / extra payout instructions
    adminNote: text("admin_note"), // admin note for manual review
    toAddress: text("to_address"), // destination wallet address
    amount: text("amount").notNull(), // USDC amount
    network: text("network"), // CAIP-2 network id (e.g. "eip155:137"), null for fiat
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed | cancelled
    txHash: text("tx_hash"), // on-chain tx hash once sent
    fee: text("fee"), // platform fee (if any)
    failReason: text("fail_reason"), // error message on failure
    reviewedBy: integer("reviewed_by"), // admin who approved/rejected
    reviewedAt: timestamp("reviewed_at"), // when the review decision was made
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_withdraw_orders_agent_id").on(t.agentId),
    index("idx_withdraw_orders_user_id").on(t.userId),
    index("idx_withdraw_orders_status").on(t.status),
    index("idx_withdraw_orders_created_at").on(t.createdAt),
  ],
);

// ── Fiat configs (system-level payment methods) ───────────────────────

export const fiatConfigs = pgTable("fiat_configs", {
  id: serial("id").primaryKey(),
  method: text("method").notNull(), // bank_transfer | alipay | wechat | paypal
  displayName: text("display_name").notNull(),
  config: text("config").notNull(), // JSON: payment details
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── API Keys (admin management keys) ──────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // user-defined label
    clientId: text("client_id").notNull().unique(), // public identifier skm_id_<12hex>
    secretHash: text("secret_hash").notNull().unique(), // SHA-256 hash
    secretPrefix: text("secret_prefix").notNull(), // first 12 chars for display
    scopes: text("scopes"), // JSON array, null = full access
    status: text("status").notNull().default("active"), // "active" | "revoked"
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("idx_api_keys_secret_hash").on(t.secretHash)],
);

// ── Announcements ─────────────────────────────────────────────────────

export const announcements = pgTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    category: text("category").notNull().default("general"),
    severity: text("severity").notNull().default("info"),
    surfaces: text("surfaces").notNull().default('["web"]'),
    relatedModels: text("related_models").notNull().default("[]"),
    startsAt: timestamp("starts_at"),
    expiresAt: timestamp("expires_at"),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").notNull(),
    sentAt: timestamp("sent_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Covers findActiveSent: WHERE status='sent' ORDER BY priority DESC, sentAt DESC.
    // PostgreSQL scans btree indexes in either direction, so this ASC index also
    // serves the DESC ordering. Prefix covers status-only lookups.
    index("idx_announcements_active_sent").on(t.status, t.priority, t.sentAt),
    index("idx_announcements_created_at").on(t.createdAt),
  ],
);

export const announcementDeliveries = pgTable(
  "announcement_deliveries",
  {
    id: serial("id").primaryKey(),
    announcementId: text("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    consumerKeyId: integer("consumer_key_id").notNull(),
    surface: text("surface").notNull(),
    deliveredAt: timestamp("delivered_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_announcement_deliveries_announcement_id").on(t.announcementId),
    index("idx_announcement_deliveries_consumer_key_id").on(t.consumerKeyId),
    uniqueIndex("uq_announcement_deliveries_announcement_consumer_surface").on(
      t.announcementId,
      t.consumerKeyId,
      t.surface,
    ),
  ],
);

// ── Webhook endpoints (system-level) ──────────────────────────────────

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    secret: text("secret").notNull(), // AES-encrypted
    events: text("events").notNull(), // JSON array
    status: text("status").notNull().default("active"), // active | paused | disabled
    failureCount: integer("failure_count").notNull().default(0),
    lastFailureAt: timestamp("last_failure_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("idx_webhook_endpoints_status").on(t.status)],
);

// ── Webhook deliveries (high-frequency append, NO FK) ─────────────────

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    endpointId: integer("endpoint_id").notNull(), // no FK
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    latencyMs: integer("latency_ms"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_webhook_deliveries_endpoint_id").on(t.endpointId),
    index("idx_webhook_deliveries_status").on(t.status),
    uniqueIndex("uq_webhook_deliveries_event_id").on(t.eventId),
  ],
);

// ── Key Providers (密钥合作方) ─────────────────────────────────────────

export const keyProviders = pgTable("key_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  contactInfo: text("contact_info"), // free-form contact details
  address: text("address"), // wallet address for withdrawals
  revenueSharePercent: real("revenue_share_percent").notNull().default(70), // % of platform profit
  balance: text("balance").notNull().default("0"), // pending settlement balance
  status: text("status").notNull().default("active"), // active | suspended
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ── Key Provider Transactions (high-frequency append, NO FK) ─────────

export const keyProviderTransactions = pgTable(
  "key_provider_transactions",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").notNull(), // no FK — high-frequency append-only
    credentialId: integer("credential_id"), // which ai_credential earned this
    type: text("type").notNull(), // revenue_share | withdraw | adjustment
    amount: text("amount").notNull(),
    balanceBefore: text("balance_before").notNull(),
    balanceAfter: text("balance_after").notNull(),
    description: text("description"),
    requestId: text("request_id"), // links to ai_usage_logs.request_id
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_key_provider_txns_provider_id").on(t.providerId),
    index("idx_key_provider_txns_created_at").on(t.createdAt),
  ],
);

// ── AI Module ─────────────────────────────────────────────────────────

export const aiSuppliers = pgTable(
  "ai_suppliers",
  {
    id: serial("id").primaryKey(),
    supplierId: text("supplier_id").notNull(), // real vendor slug: "deepseek", "openai"
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    authType: text("auth_type").notNull().default("bearer"), // default auth mode for official endpoints
    authConfig: text("auth_config").notNull().default("{}"), // JSON: { headerName?, clientId?, region?, accessKeyId? }
    officialConcurrencyLimit: integer("official_concurrency_limit"),
    officialQueueTimeoutMs: integer("official_queue_timeout_ms").notNull().default(30_000),
    metadata: text("metadata").notNull().default("{}"),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("ai_suppliers_supplier_id_unique").on(t.supplierId),
    index("idx_ai_suppliers_enabled").on(t.enabled),
  ],
);

export const aiEndpoints = pgTable(
  "ai_endpoints",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => aiSuppliers.id, { onDelete: "cascade" }),
    endpointId: text("endpoint_id").notNull().unique(), // slug: "deepseek-openai"
    name: text("name").notNull(), // display name
    baseUrl: text("base_url").notNull(), // e.g. "https://api.openai.com/v1"
    apiFormat: text("api_format").notNull(), // "openai" | "anthropic" | "gemini"
    authMode: text("auth_mode").notNull().default("inherit"), // "inherit" | "override"
    authType: text("auth_type").notNull(), // "bearer" | "api-key" | "sigv4" | "cloudflare"
    authConfig: text("auth_config").notNull().default("{}"), // JSON: { headerName?: string, clientId?: string }
    enabled: boolean("enabled").notNull().default(true),
    loadBalanceStrategy: text("load_balance_strategy").notNull().default("round-robin"), // "round-robin" | "random"
    upstreamRoutingStrategy: text("upstream_routing_strategy").notNull().default("priority"), // "priority" | "weighted-random"
    concurrencyMode: text("concurrency_mode").notNull().default("inherit"), // "inherit" | "override"
    officialConcurrencyLimit: integer("official_concurrency_limit"),
    officialQueueTimeoutMs: integer("official_queue_timeout_ms").notNull().default(30_000),
    iconUrl: text("icon_url"),
    // `enabled` = admin intent; `autoDisabled` = system status.
    // Effective active = enabled && !autoDisabled.
    healthStatus: text("health_status").notNull().default("unknown"), // "unknown" | "healthy" | "degraded" | "down"
    lastCheckedAt: timestamp("last_checked_at"),
    lastSuccessAt: timestamp("last_success_at"),
    lastFailureAt: timestamp("last_failure_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    autoDisabled: boolean("auto_disabled").notNull().default(false),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_ai_endpoints_endpoint_id").on(t.endpointId),
    index("idx_ai_endpoints_supplier_id").on(t.supplierId),
  ],
);

export const aiUpstreams = pgTable("ai_upstreams", {
  id: serial("id").primaryKey(),
  upstreamId: text("upstream_id")
    .notNull()
    .unique()
    .$defaultFn(() => generateUuidV7()),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  kind: text("kind").notNull().default("custom"), // "official" | "reseller" | "openrouter" | "custom"
  modelsEndpoint: text("models_endpoint"),
  enabled: boolean("enabled").notNull().default(true),
  concurrencyLimit: integer("concurrency_limit"),
  queueTimeoutMs: integer("queue_timeout_ms").notNull().default(30_000),
  metadata: text("metadata").notNull().default("{}"),
  healthStatus: text("health_status").notNull().default("unknown"), // "unknown" | "healthy" | "degraded" | "down"
  lastCheckedAt: timestamp("last_checked_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  autoDisabled: boolean("auto_disabled").notNull().default(false),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const aiUpstreamAssignments = pgTable(
  "ai_upstream_assignments",
  {
    id: serial("id").primaryKey(),
    endpointId: integer("endpoint_id")
      .notNull()
      .references(() => aiEndpoints.id, { onDelete: "cascade" }),
    upstreamId: integer("upstream_id")
      .notNull()
      .references(() => aiUpstreams.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    weight: integer("weight").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.endpointId, t.upstreamId),
    index("idx_ai_upstream_assignments_endpoint_id").on(t.endpointId),
    index("idx_ai_upstream_assignments_upstream_id").on(t.upstreamId),
  ],
);

export const aiUpstreamModelMappings = pgTable(
  "ai_upstream_model_mappings",
  {
    id: serial("id").primaryKey(),
    upstreamId: integer("upstream_id")
      .notNull()
      .references(() => aiUpstreams.id, { onDelete: "cascade" }),
    sourceModelId: text("source_model_id").notNull(),
    mappedModelId: text("mapped_model_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.upstreamId, t.sourceModelId),
    index("idx_ai_upstream_model_mappings_upstream_id").on(t.upstreamId),
  ],
);

export const aiModels = pgTable(
  "ai_models",
  {
    id: serial("id").primaryKey(),
    modelId: text("model_id").notNull(), // public model slug: "gpt-4o", "glm-5.2"
    name: text("name").notNull(), // display name
    contextWindow: integer("context_window"), // max tokens
    inputPrice: text("input_price").notNull().default("0"), // per 1M tokens
    outputPrice: text("output_price").notNull().default("0"), // per 1M tokens
    capabilities: text("capabilities").notNull().default("[]"), // JSON array: ["chat","vision","tools","streaming"]
    fallbackModelIds: text("fallback_model_ids"), // JSON array of model_id slugs for fallback chain, nullable
    limitedFreeUntil: timestamp("limited_free_until"), // nullable — active limited-free tag until this timestamp
    grayReleaseEnabled: boolean("gray_release_enabled").notNull().default(false),
    weight: integer("weight").notNull().default(1), // load balancing weight for fallback shuffling
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.modelId),
    index("idx_ai_models_model_id").on(t.modelId),
    index("idx_ai_models_limited_free_until").on(t.limitedFreeUntil),
  ],
);

export const aiModelRoutes = pgTable(
  "ai_model_routes",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "cascade" }),
    endpointId: integer("endpoint_id")
      .notNull()
      .references(() => aiEndpoints.id, { onDelete: "cascade" }),
    endpointModelId: text("endpoint_model_id"), // actual slug sent upstream; null = use model.modelId
    priority: integer("priority").notNull().default(100), // lower = tried first
    weight: integer("weight").notNull().default(1), // for weighted-random within same priority
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.modelId, t.endpointId),
    index("idx_ai_model_routes_model_id").on(t.modelId),
    index("idx_ai_model_routes_endpoint_id").on(t.endpointId),
  ],
);

export const aiModelGrayUsers = pgTable(
  "ai_model_gray_users",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.modelId, t.userId),
    index("idx_ai_model_gray_users_model_id").on(t.modelId),
    index("idx_ai_model_gray_users_user_id").on(t.userId),
  ],
);

export const aiCredentials = pgTable(
  "ai_credentials",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id").references(() => aiSuppliers.id, {
      onDelete: "set null",
    }),
    ownerId: integer("owner_id").references(() => keyProviders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastUsedAt: timestamp("last_used_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_ai_credentials_supplier_id").on(t.supplierId),
    index("idx_ai_credentials_owner_id").on(t.ownerId),
  ],
);

export const aiEndpointCredentials = pgTable(
  "ai_endpoint_credentials",
  {
    id: serial("id").primaryKey(),
    endpointId: integer("endpoint_id")
      .notNull()
      .references(() => aiEndpoints.id, { onDelete: "cascade" }),
    upstreamId: integer("upstream_id").references(() => aiUpstreams.id, {
      onDelete: "set null",
    }),
    credentialId: integer("credential_id")
      .notNull()
      .references(() => aiCredentials.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // endpoint-local label
    weight: integer("weight").notNull().default(1), // load balancing weight (0 = excluded from pool)
    enabled: boolean("enabled").notNull().default(true),
    lastUsedAt: timestamp("last_used_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_ai_endpoint_credentials_official")
      .on(t.endpointId, t.credentialId)
      .where(sql`${t.upstreamId} IS NULL`),
    uniqueIndex("uq_ai_endpoint_credentials_upstream")
      .on(t.endpointId, t.credentialId, t.upstreamId)
      .where(sql`${t.upstreamId} IS NOT NULL`),
    index("idx_ai_endpoint_credentials_endpoint_id").on(t.endpointId),
    index("idx_ai_endpoint_credentials_upstream_id").on(t.upstreamId),
    index("idx_ai_endpoint_credentials_credential_id").on(t.credentialId),
  ],
);

export const aiGuardrailConfigs = pgTable("ai_guardrail_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rules: text("rules").notNull().default("[]"), // JSON array of GuardrailRule objects
  action: text("action").notNull().default("block"), // "block" | "warn" | "log"
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: serial("id").primaryKey(),
    endpointCredentialId: integer("endpoint_credential_id"), // no FK — hot-path append
    credentialId: integer("credential_id"), // no FK — hot-path append
    credentialOwnerId: integer("credential_owner_id"), // owner snapshot at log-write time
    consumerKeyId: integer("consumer_key_id"), // no FK — set when consumer key is used
    userId: integer("user_id"), // no FK — set when user is identified
    supplierId: text("supplier_id"), // denormalized slug
    endpointId: text("endpoint_id"), // denormalized slug
    modelId: text("model_id"), // denormalized slug
    upstreamId: integer("upstream_id"),
    upstreamName: text("upstream_name"),
    upstreamBaseUrl: text("upstream_base_url"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    estimatedCost: text("estimated_cost"), // numeric string — consumer cost (after markup)
    upstreamCost: text("upstream_cost"), // numeric string — raw cost before markup
    markupPercent: real("markup_percent"), // markup % applied at billing time
    latencyMs: integer("latency_ms"),
    statusCode: integer("status_code"),
    requestId: text("request_id"),
    error: text("error"),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_ai_usage_logs_created_at").on(t.createdAt),
    index("idx_ai_usage_logs_supplier_id").on(t.supplierId),
    index("idx_ai_usage_logs_endpoint_id").on(t.endpointId),
    index("idx_ai_usage_logs_consumer_key").on(t.consumerKeyId),
    index("idx_ai_usage_logs_user_id").on(t.userId),
    index("idx_ai_usage_logs_endpoint_credential_id").on(t.endpointCredentialId),
    index("idx_ai_usage_logs_credential_id").on(t.credentialId),
    index("idx_ai_usage_logs_credential_owner_id").on(t.credentialOwnerId),
    index("idx_ai_usage_logs_upstream_id").on(t.upstreamId),
  ],
);

// ── Relay Consumer Keys (user-owned API keys for AI relay) ────────────

export const relayConsumerKeys = pgTable(
  "relay_consumer_keys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }), // nullable — null = admin-created orphan key
    agentId: integer("agent_id")
      .notNull()
      .references(() => payAgents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    apiKeyHash: text("api_key_hash").notNull().unique(),
    apiKeyPrefix: text("api_key_prefix").notNull(),
    encryptedKey: text("encrypted_key").notNull().default(""), // AES-encrypted raw key for reveal
    markupPercent: real("markup_percent"), // null = inherit from agent's defaultMarkupPercent
    rateLimitRpm: integer("rate_limit_rpm"),
    allowedModels: text("allowed_models").notNull().default("[]"),
    status: text("status").notNull().default("active"), // active | suspended
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_relay_consumer_keys_user_id").on(t.userId),
    index("idx_relay_consumer_keys_agent_id").on(t.agentId),
  ],
);

// ── Relay Consumer Key Blacklist (deleted keys) ──────────────────────

export const relayConsumerKeyBlacklist = pgTable(
  "relay_consumer_key_blacklist",
  {
    id: serial("id").primaryKey(),
    relayConsumerKeyId: integer("relay_consumer_key_id"), // original key id before deletion
    userId: integer("user_id"), // nullable — admin-created orphan keys have no owner
    agentId: integer("agent_id").notNull(),
    name: text("name").notNull(),
    apiKeyHash: text("api_key_hash").notNull().unique(),
    apiKeyPrefix: text("api_key_prefix").notNull(),
    deletedAt: timestamp("deleted_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_relay_consumer_key_blacklist_user_id").on(t.userId),
    index("idx_relay_consumer_key_blacklist_agent_id").on(t.agentId),
  ],
);

// ── Type exports ──────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PayAgent = typeof payAgents.$inferSelect;
export type NewPayAgent = typeof payAgents.$inferInsert;
export type PayAgentTransaction = typeof payAgentTransactions.$inferSelect;
export type NewPayAgentTransaction = typeof payAgentTransactions.$inferInsert;
export type SupportedNetwork = typeof supportedNetworks.$inferSelect;
export type NewSupportedNetwork = typeof supportedNetworks.$inferInsert;
export type AllowedToken = typeof allowedTokens.$inferSelect;
export type NewAllowedToken = typeof allowedTokens.$inferInsert;
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type GlobalSetting = typeof globalSettings.$inferSelect;
export type NewGlobalSetting = typeof globalSettings.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type Identity = typeof identities.$inferSelect;
export type NewIdentity = typeof identities.$inferInsert;
export type NotificationConfig = typeof notificationConfigs.$inferSelect;
export type NewNotificationConfig = typeof notificationConfigs.$inferInsert;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
export type TopUpOrder = typeof topUpOrders.$inferSelect;
export type NewTopUpOrder = typeof topUpOrders.$inferInsert;
export type FiatConfig = typeof fiatConfigs.$inferSelect;
export type NewFiatConfig = typeof fiatConfigs.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type AnnouncementDelivery = typeof announcementDeliveries.$inferSelect;
export type NewAnnouncementDelivery = typeof announcementDeliveries.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type AiEndpoint = typeof aiEndpoints.$inferSelect;
export type NewAiEndpoint = typeof aiEndpoints.$inferInsert;
export type AiUpstream = typeof aiUpstreams.$inferSelect;
export type NewAiUpstream = typeof aiUpstreams.$inferInsert;
export type AiUpstreamAssignment = typeof aiUpstreamAssignments.$inferSelect;
export type NewAiUpstreamAssignment = typeof aiUpstreamAssignments.$inferInsert;
export type AiUpstreamModelMapping = typeof aiUpstreamModelMappings.$inferSelect;
export type NewAiUpstreamModelMapping = typeof aiUpstreamModelMappings.$inferInsert;
export type AiModel = typeof aiModels.$inferSelect;
export type NewAiModel = typeof aiModels.$inferInsert;
export type AiModelRoute = typeof aiModelRoutes.$inferSelect;
export type NewAiModelRoute = typeof aiModelRoutes.$inferInsert;
export type AiModelGrayUser = typeof aiModelGrayUsers.$inferSelect;
export type NewAiModelGrayUser = typeof aiModelGrayUsers.$inferInsert;
export type AiSupplier = typeof aiSuppliers.$inferSelect;
export type NewAiSupplier = typeof aiSuppliers.$inferInsert;
export type AiCredential = typeof aiCredentials.$inferSelect;
export type NewAiCredential = typeof aiCredentials.$inferInsert;
export type AiEndpointCredential = typeof aiEndpointCredentials.$inferSelect;
export type NewAiEndpointCredential = typeof aiEndpointCredentials.$inferInsert;
export type AiGuardrailConfig = typeof aiGuardrailConfigs.$inferSelect;
export type NewAiGuardrailConfig = typeof aiGuardrailConfigs.$inferInsert;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLogs.$inferInsert;
export type RelayConsumerKey = typeof relayConsumerKeys.$inferSelect;
export type NewRelayConsumerKey = typeof relayConsumerKeys.$inferInsert;
export type RelayConsumerKeyBlacklist = typeof relayConsumerKeyBlacklist.$inferSelect;
export type NewRelayConsumerKeyBlacklist = typeof relayConsumerKeyBlacklist.$inferInsert;
export type WithdrawOrder = typeof withdrawOrders.$inferSelect;
export type NewWithdrawOrder = typeof withdrawOrders.$inferInsert;
export type KeyProvider = typeof keyProviders.$inferSelect;
export type NewKeyProvider = typeof keyProviders.$inferInsert;
export type KeyProviderTransaction = typeof keyProviderTransactions.$inferSelect;
export type NewKeyProviderTransaction = typeof keyProviderTransactions.$inferInsert;
