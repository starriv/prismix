/**
 * Notification provider configuration — DB-backed with in-memory cache.
 *
 * Controls which notification channels (email, telegram, webhook, whatsapp)
 * are enabled at the platform level, including platform-level credentials.
 *
 * Default config is seeded into global_settings via deploy/seed/*.sql.
 * Secrets (SMTP password, Bot Token, API keys) are AES-256-GCM encrypted.
 */
import type { ChannelType } from "@/server/messaging/notifications/channel";

import { settingsRepo } from "../repos";
import { decrypt, encrypt } from "./crypto";
import { log } from "./logger";

// ── Types ───────────────────────────────────────────────────────────

export interface EmailProviderConfig {
  enabled: boolean;
  provider: "smtp" | "resend";
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  resendApiKey?: string;
  fromAddress?: string;
  fromName?: string;
}

export interface TelegramProviderConfig {
  enabled: boolean;
  botToken?: string;
}

export interface WebhookProviderConfig {
  enabled: boolean;
}

export interface WhatsappProviderConfig {
  enabled: boolean;
  apiToken?: string;
  phoneNumberId?: string;
}

export interface NotificationProvidersConfig {
  email: EmailProviderConfig;
  telegram: TelegramProviderConfig;
  webhook: WebhookProviderConfig;
  whatsapp: WhatsappProviderConfig;
}

// ── Constants ───────────────────────────────────────────────────────

const DB_KEY = "notification_providers";
const DOMAIN_TAG = "notification-provider-config";

/** Fields that contain secrets and should be encrypted */
const SECRET_FIELDS = ["smtpPass", "resendApiKey", "botToken", "apiToken"];

// ── Encrypt / Decrypt secrets ───────────────────────────────────────

function encryptSecrets(config: NotificationProvidersConfig): NotificationProvidersConfig {
  const result = JSON.parse(JSON.stringify(config)) as NotificationProvidersConfig;
  for (const channel of Object.values(result)) {
    for (const field of SECRET_FIELDS) {
      const val = (channel as Record<string, unknown>)[field];
      if (typeof val === "string" && val.length > 0 && val !== "****") {
        try {
          (channel as Record<string, unknown>)[field] = encrypt(val, DOMAIN_TAG);
        } catch {
          // If encryption fails, store as-is
        }
      }
    }
  }
  return result;
}

function decryptSecrets(config: NotificationProvidersConfig): NotificationProvidersConfig {
  const result = JSON.parse(JSON.stringify(config)) as NotificationProvidersConfig;
  for (const [channelKey, channel] of Object.entries(result)) {
    for (const field of SECRET_FIELDS) {
      const val = (channel as Record<string, unknown>)[field];
      if (typeof val === "string" && val.includes(":")) {
        try {
          (channel as Record<string, unknown>)[field] = decrypt(val, DOMAIN_TAG);
        } catch {
          log.notification.warn(
            { channel: channelKey, field },
            "Failed to decrypt secret, clearing",
          );
          (channel as Record<string, unknown>)[field] = "";
        }
      }
    }
  }
  return result;
}

// ── Cache ───────────────────────────────────────────────────────────

let cached: NotificationProvidersConfig | null = null;

const DEFAULT_CONFIG: NotificationProvidersConfig = {
  email: { enabled: false, provider: "smtp" },
  telegram: { enabled: false },
  webhook: { enabled: true },
  whatsapp: { enabled: false },
};

export function getNotificationProviderConfigCached(): NotificationProvidersConfig {
  if (!cached) {
    log.notification.warn("Notification provider config not initialized — returning defaults");
  }
  return cached ?? DEFAULT_CONFIG;
}

export async function initNotificationProviderConfig(): Promise<void> {
  const raw = await settingsRepo.getGlobal(DB_KEY);
  if (raw) {
    try {
      cached = decryptSecrets(JSON.parse(raw) as NotificationProvidersConfig);
    } catch {
      log.notification.error("Failed to parse notification_providers from DB");
      cached = { ...DEFAULT_CONFIG };
    }
  } else {
    log.notification.warn(
      "No notification_providers in DB — all channels disabled until configured via admin",
    );
    cached = { ...DEFAULT_CONFIG };
  }
}

export async function saveNotificationProviderConfig(
  config: NotificationProvidersConfig,
): Promise<void> {
  const encrypted = encryptSecrets(config);
  await settingsRepo.setGlobal(DB_KEY, JSON.stringify(encrypted));
  cached = config;
}

export function invalidateNotificationProviderConfig(): void {
  cached = null;
}

// ── Query helpers ───────────────────────────────────────────────────

export function isChannelEnabled(channel: ChannelType): boolean {
  const config = getNotificationProviderConfigCached();
  return config[channel]?.enabled ?? false;
}

export function getChannelConfig(channel: ChannelType): Record<string, unknown> {
  const config = getNotificationProviderConfigCached();
  return (config[channel] as unknown as Record<string, unknown>) ?? {};
}

export function listEnabledChannels(): ChannelType[] {
  const all: ChannelType[] = ["email", "telegram", "webhook", "whatsapp"];
  return all.filter(isChannelEnabled);
}
