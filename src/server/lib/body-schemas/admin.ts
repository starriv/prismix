/**
 * Admin-domain Zod body schemas: admin management, auth providers,
 * notification providers, SAML, broadcast, announcements, allowed tokens,
 * networks, key providers, pay agents, fiat config, user management.
 */
import { z } from "zod";

import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_SURFACES,
} from "@/shared/announcements";
import { PRICE_RE } from "@/shared/number";

// ── Regex validators ────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// ── Admin: Create Admin ────────────────────────────────────────────

export const createAdminBody = z.object({
  name: z.string().min(1, "Name is required").max(100),
  provider: z.string().min(1, "Provider is required").max(50),
  providerAccountId: z.string().min(1, "Provider account ID is required").max(200),
  email: z.string().email().max(200).optional().or(z.literal("")),
  address: z
    .string()
    .regex(ETH_ADDRESS_RE, "Invalid Ethereum address")
    .optional()
    .or(z.literal("")),
  password: z.string().min(10).max(128).optional(),
});

// ── Admin: Auth Provider Config ───────────────────────────────────

const authProviderEntrySchema = z
  .object({
    enabled: z.boolean().optional(),
    clientId: z.string().max(500).optional(),
    clientSecret: z.string().max(2000).optional(),
    issuer: z.string().max(500).optional(),
    scopes: z.array(z.string().max(100)).optional(),
    displayName: z.string().max(100).optional(),
    entityId: z.string().max(500).optional(),
    ssoUrl: z.string().max(2000).optional(),
    sloUrl: z.string().max(2000).optional(),
    certificate: z.string().max(10000).optional(),
    metadataUrl: z.string().url().max(2000).optional().or(z.literal("")),
  })
  .partial();

export const updateAuthProvidersBody = z.record(z.string().max(50), authProviderEntrySchema);

// ── Admin: Notification Provider Config ────────────────────────────

const emailProviderConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.enum(["smtp", "resend"]).optional(),
    smtpHost: z.string().max(200).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpUser: z.string().max(200).optional(),
    smtpPass: z.string().max(500).optional(),
    resendApiKey: z.string().max(500).optional(),
    fromAddress: z.string().max(200).optional(),
    fromName: z.string().max(100).optional(),
  })
  .partial();

const telegramProviderConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    botToken: z.string().max(500).optional(),
  })
  .partial();

const webhookProviderConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .partial();

const whatsappProviderConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiToken: z.string().max(500).optional(),
    phoneNumberId: z.string().max(100).optional(),
  })
  .partial();

export const updateNotificationProvidersBody = z.object({
  email: emailProviderConfigSchema.optional(),
  telegram: telegramProviderConfigSchema.optional(),
  webhook: webhookProviderConfigSchema.optional(),
  whatsapp: whatsappProviderConfigSchema.optional(),
});

// ── Admin: SAML Discovery ──────────────────────────────────────────

export const discoverSamlBody = z.object({
  metadataUrl: z
    .string()
    .url("Must be a valid URL")
    .max(2048)
    .startsWith("https://", "Must use HTTPS"),
});

// ── Admin: Broadcast ──────────────────────────────────────────────

export const broadcastBody = z.object({
  title: z.string().min(1, "Title is required").max(200),
  body: z.string().min(1, "Body is required").max(5000),
});

// ── Admin: Allowed Tokens ────────────────────────────────────────────

export const createAllowedTokenBody = z.object({
  symbol: z.string().min(1).max(20),
  network: z.string().min(1).max(50),
  contractAddress: z.string().regex(ETH_ADDRESS_RE, "Invalid contract address"),
});

export const updateAllowedTokenBody = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
});

// ── Admin: Supported Networks ───────────────────────────────────────

export const createNetworkBody = z.object({
  chainId: z.number().int().positive(),
  networkId: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  shortName: z.string().max(20).optional().default(""),
  explorerUrl: z.string().max(500).optional().default(""),
  testnet: z.boolean().optional().default(false),
  iconUrl: z.string().max(500).optional().default(""),
  rpcUrl: z.string().max(500).optional().default(""),
});

export const updateNetworkBody = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  rpcUrl: z.string().max(500).optional(),
});

// ── Admin: Announcements ────────────────────────────────────────────

const announcementDateField = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") return new Date(value);
    return value;
  },
  z
    .date()
    .refine((date) => !Number.isNaN(date.getTime()), "Invalid date")
    .nullable()
    .optional(),
);

const announcementCategory = z.enum(ANNOUNCEMENT_CATEGORIES);
const announcementSeverity = z.enum(ANNOUNCEMENT_SEVERITIES);
const announcementSurface = z.enum(ANNOUNCEMENT_SURFACES);
const announcementModels = z.array(z.string().trim().min(1).max(200)).max(100);
const announcementSurfaces = z.array(announcementSurface).min(1);

export const createAnnouncementBody = z.object({
  title: z.string().min(1, "Title is required").max(200),
  body: z.string().min(1, "Body is required").max(5000),
  link: z.string().url().max(500).optional().or(z.literal("")),
  category: announcementCategory.optional().default("general"),
  severity: announcementSeverity.optional().default("info"),
  surfaces: announcementSurfaces.optional().default(["web"]),
  relatedModels: announcementModels.optional().default([]),
  startsAt: announcementDateField,
  expiresAt: announcementDateField,
  priority: z.number().int().min(-1000).max(1000).optional().default(0),
});

export const updateAnnouncementBody = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  link: z.string().url().max(500).optional().or(z.literal("")),
  category: announcementCategory.optional(),
  severity: announcementSeverity.optional(),
  surfaces: announcementSurfaces.optional(),
  relatedModels: announcementModels.optional(),
  startsAt: announcementDateField,
  expiresAt: announcementDateField,
  priority: z.number().int().min(-1000).max(1000).optional(),
});

// ── Admin: User Management ────────────────────────────────────────────

export const updateUserBody = z.object({
  name: z.string().min(1, "Name is required").max(200).optional(),
  email: z.string().email("Invalid email").optional(),
  status: z.number().int().min(1).max(2).optional(),
  agentId: z.number().int().positive().nullable().optional(),
});

export const creditUserBody = z.object({
  amount: z.string().min(1, "Amount is required").regex(PRICE_RE, "Invalid amount format"),
  description: z.string().max(500).optional(),
});

// ── Pay Agent ───────────────────────────────────────────────────────

export const createAgentBody = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  defaultMarkupPercent: z.number().min(0).max(1000).nullable().optional(),
});

export const updateAgentBody = z.object({
  id: z.number({ message: "Pay agent ID is required" }),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  perPayLimit: z.string().regex(PRICE_RE, "Invalid limit format").nullable().optional(),
  dailyLimit: z.string().regex(PRICE_RE, "Invalid limit format").nullable().optional(),
  monthlyLimit: z.string().regex(PRICE_RE, "Invalid limit format").nullable().optional(),
  defaultMarkupPercent: z.number().min(0).max(1000).nullable().optional(),
});

export const manualTopupBody = z.object({
  amount: z.string().min(1, "Amount is required").regex(PRICE_RE, "Invalid amount format"),
  note: z.string().max(500).optional(),
});

// ── Fiat Config ────────────────────────────────────────────────────

export const createFiatConfigBody = z.object({
  method: z.enum(["bank_transfer", "alipay", "wechat", "paypal"], {
    message: "Method must be bank_transfer, alipay, wechat, or paypal",
  }),
  displayName: z.string().min(1, "Display name is required").max(100),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export const updateFiatConfigBody = z.object({
  id: z.number({ message: "Fiat config ID is required" }),
  displayName: z.string().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const reorderFiatConfigsBody = z.object({
  ids: z.array(z.number().int().positive()).min(1, "At least one ID is required"),
});

// ── Key Provider ────────────────────────────────────────────────────

export const createKeyProviderBody = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email().max(200).optional().or(z.literal("")),
  contactInfo: z.string().max(500).optional(),
  address: z.string().max(100).optional().or(z.literal("")),
  revenueSharePercent: z.number().min(0).max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const updateKeyProviderBody = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).nullable().optional().or(z.literal("")),
  contactInfo: z.string().max(500).nullable().optional(),
  address: z.string().max(100).nullable().optional().or(z.literal("")),
  revenueSharePercent: z.number().min(0).max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const adjustKeyProviderBalanceBody = z.object({
  amount: z.string().min(1, "Amount is required").regex(PRICE_RE, "Invalid amount format"),
  type: z.enum(["credit", "debit"]),
  description: z.string().max(500).optional(),
});

// ── Admin: Gateway Config ───────────────────────────────────────────

export const updateGatewayConfigBody = z.object({
  rateLimits: z
    .array(
      z
        .object({
          name: z.string(),
          pathPattern: z.string(),
          maxRequests: z.number().int().positive(),
          windowMs: z.number().int().positive(),
          dimension: z.enum(["ip", "token", "global"]),
          enabled: z.boolean(),
        })
        .passthrough(),
    )
    .optional(),
  circuitBreakers: z
    .array(
      z
        .object({
          name: z.string(),
          failureThreshold: z.number().int().positive(),
          resetTimeoutMs: z.number().int().positive(),
          halfOpenRequests: z.number().int().positive(),
          enabled: z.boolean(),
        })
        .passthrough(),
    )
    .optional(),
  timeouts: z
    .object({
      upstreamFetchMs: z.number().int().positive(),
      streamIdleMs: z.number().int().positive().optional(),
      streamMaxDurationMs: z.number().int().positive().optional(),
      upstreamFetchOverrides: z
        .array(
          z
            .object({
              providerId: z.string().trim().optional(),
              modelId: z.string().trim().optional(),
              upstreamFetchMs: z.number().int().positive(),
            })
            .refine((value) => value.providerId || value.modelId, {
              message: "providerId or modelId is required",
            }),
        )
        .optional(),
    })
    .optional(),
  queue: z
    .object({
      maxWriteQueueDepth: z.number().int().positive(),
      maxLogQueueDepth: z.number().int().positive(),
    })
    .optional(),
});
