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

// ── Adapter initialisation ──────────────────────────────────────────

const _adapter: DbAdapter = new PgAdapter();
await _adapter.init?.();

// ── Core exports ────────────────────────────────────────────────────

/** The Drizzle ORM instance (PostgreSQL). */
export const db = _adapter.db;

/** Graceful shutdown — release database connections. */
export const closeDb = () => _adapter.close();

// ── Query helpers (delegated to active adapter) ─────────────────────

export const queryOne = <T>(qb: unknown) => _adapter.queryOne<T>(qb);
export const queryAll = <T>(qb: unknown) => _adapter.queryAll<T>(qb);
export const exec = (qb: unknown) => _adapter.exec(qb);
export const returningOne = <T>(qb: unknown) => _adapter.returningOne<T>(qb);
export const execWithChanges = (qb: unknown) => _adapter.execWithChanges(qb);
export const transaction = <T>(fn: (tx: unknown) => Promise<T>) => _adapter.transaction(fn);

// ── Schema table re-exports ─────────────────────────────────────────

const s = _adapter.schema;
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
