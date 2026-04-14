/**
 * Database barrel — PostgreSQL only.
 *
 * Instantiates the PgAdapter and re-exports a clean public API:
 *
 *   import { db, queryOne, resources, closeDb, type Resource } from "@/server/db";
 *
 * Consumers never interact with the adapter class directly.
 */
import type { DbAdapter } from "./adapter";
import { PgAdapter } from "./pg-adapter";
import * as schema from "./schemas/pg";

// ── Adapter initialisation (lazy — created on first access) ─────────
// PgAdapter construction connects to PG, so we defer it to avoid
// crashing the process at module-load time when the DB is unreachable.

let _adapter: DbAdapter | null = null;

function getAdapter(): DbAdapter {
  if (!_adapter) {
    _adapter = new PgAdapter();
  }
  return _adapter;
}

/** Called from bootstrap() — runs first-deploy migrations + seed. */
export async function initDb(): Promise<void> {
  await getAdapter().init?.();
}

// ── Core exports ────────────────────────────────────────────────────

/** The Drizzle ORM instance (PostgreSQL). */
export const db = new Proxy({} as DbAdapter["db"], {
  get(_, prop) {
    return getAdapter().db[prop];
  },
});

/** Graceful shutdown — release database connections. */
export const closeDb = () => (_adapter ? _adapter.close() : Promise.resolve());

// ── Query helpers (delegated to active adapter) ─────────────────────

export const queryOne = <T>(qb: unknown) => getAdapter().queryOne<T>(qb);
export const queryAll = <T>(qb: unknown) => getAdapter().queryAll<T>(qb);
export const exec = (qb: unknown) => getAdapter().exec(qb);
export const returningOne = <T>(qb: unknown) => getAdapter().returningOne<T>(qb);
export const execWithChanges = (qb: unknown) => getAdapter().execWithChanges(qb);
export const transaction = <T>(fn: (tx: unknown) => Promise<T>) => getAdapter().transaction(fn);

// ── Schema table re-exports ─────────────────────────────────────────

const s = schema;
export const users = s.users;
export const payAgents = s.payAgents;
export const payAgentTransactions = s.payAgentTransactions;
export const supportedNetworks = s.supportedNetworks;
export const allowedTokens = s.allowedTokens;
export const admins = s.admins;
export const globalSettings = s.globalSettings;
export const refreshTokens = s.refreshTokens;
export const identities = s.identities;
export const notificationConfigs = s.notificationConfigs;
export const notificationLogs = s.notificationLogs;
export const topUpOrders = s.topUpOrders;
export const fiatConfigs = s.fiatConfigs;
export const apiKeys = s.apiKeys;
export const announcements = s.announcements;
export const webhookEndpoints = s.webhookEndpoints;
export const webhookDeliveries = s.webhookDeliveries;
export const withdrawOrders = s.withdrawOrders;
export const keyProviders = s.keyProviders;
export const keyProviderTransactions = s.keyProviderTransactions;
export const aiProviders = s.aiProviders;
export const aiUpstreams = s.aiUpstreams;
export const aiUpstreamAssignments = s.aiUpstreamAssignments;
export const aiModels = s.aiModels;
export const aiKeys = s.aiKeys;
export const aiGuardrailConfigs = s.aiGuardrailConfigs;
export const aiUsageLogs = s.aiUsageLogs;
export const relayConsumerKeys = s.relayConsumerKeys;

// ── Entity type re-exports ──────────────────────────────────────────

export type {
  Admin,
  AiGuardrailConfig,
  AiKey,
  AiModel,
  AiProvider,
  AiUpstream,
  AiUpstreamAssignment,
  AiUsageLog,
  AllowedToken,
  Announcement,
  ApiKey,
  FiatConfig,
  GlobalSetting,
  Identity,
  KeyProvider,
  KeyProviderTransaction,
  NewAdmin,
  NewAiGuardrailConfig,
  NewAiKey,
  NewAiModel,
  NewAiProvider,
  NewAiUpstream,
  NewAiUpstreamAssignment,
  NewAiUsageLog,
  NewAllowedToken,
  NewAnnouncement,
  NewApiKey,
  NewFiatConfig,
  NewGlobalSetting,
  NewIdentity,
  NewKeyProvider,
  NewKeyProviderTransaction,
  NewNotificationConfig,
  NewNotificationLog,
  NewPayAgent,
  NewPayAgentTransaction,
  NewRefreshToken,
  NewRelayConsumerKey,
  NewSupportedNetwork,
  NewTopUpOrder,
  NewUser,
  NewWebhookDelivery,
  NewWebhookEndpoint,
  NewWithdrawOrder,
  NotificationConfig,
  NotificationLog,
  PayAgent,
  PayAgentTransaction,
  RefreshToken,
  RelayConsumerKey,
  SupportedNetwork,
  TopUpOrder,
  User,
  WebhookDelivery,
  WebhookEndpoint,
  WithdrawOrder,
} from "./types";
