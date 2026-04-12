/**
 * Shared types for the repository layer.
 *
 * Re-exports entity types from the Drizzle schema so that consumers
 * import from `@/server/repos` instead of `@/db/schema` directly.
 */

export type {
  Admin,
  AiKey,
  AllowedToken,
  ApiKey,
  PayAgent,
  PayAgentTransaction,
  GlobalSetting,
  NewAdmin,
  NewAiKey,
  NewAllowedToken,
  NewApiKey,
  NewPayAgent,
  NewPayAgentTransaction,
  NewGlobalSetting,
  NewRefreshToken,
  NewSupportedNetwork,
  NewUser,
  RefreshToken,
  SupportedNetwork,
  User,
  WebhookEndpoint,
  NewWebhookEndpoint,
  WebhookDelivery,
  NewWebhookDelivery,
} from "@/server/db";

export interface PaginationParams {
  limit: number;
  offset: number;
}
