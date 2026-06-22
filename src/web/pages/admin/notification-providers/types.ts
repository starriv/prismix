export interface EmailConfig {
  enabled: boolean;
  provider: "smtp" | "resend";
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  resendKey: string;
  fromAddress: string;
  fromName: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface WebhookConfig {
  enabled: boolean;
}

export interface WhatsAppConfig {
  enabled: boolean;
  apiToken: string;
  phoneNumberId: string;
}

export interface ConfigState {
  email: EmailConfig;
  telegram: TelegramConfig;
  webhook: WebhookConfig;
  whatsapp: WhatsAppConfig;
}

export const INITIAL_STATE: ConfigState = {
  email: {
    enabled: false,
    provider: "smtp",
    smtpHost: "",
    smtpPort: "587",
    smtpUser: "",
    smtpPass: "",
    resendKey: "",
    fromAddress: "",
    fromName: "",
  },
  telegram: { enabled: false, botToken: "", chatId: "" },
  webhook: { enabled: false },
  whatsapp: { enabled: false, apiToken: "", phoneNumberId: "" },
};

// ── Validation ───────────────────────────────────────────────────────

export const VALID_SMTP_PORTS = ["25", "465", "587", "2525"];
export const HOSTNAME_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RESEND_KEY_RE = /^re_[a-zA-Z0-9_]{10,}$/;
export const TELEGRAM_TOKEN_RE = /^[0-9]+:[A-Za-z0-9_-]{35}$/;
export const TELEGRAM_CHAT_ID_RE = /^-?\d+$/;
export const WHATSAPP_TOKEN_RE = /^EAA/;
export const WHATSAPP_PHONE_ID_RE = /^\d{9,20}$/;

export function validateConfig(config: ConfigState): string | null {
  if (config.email.enabled) {
    if (config.email.provider === "smtp") {
      if (config.email.smtpHost && !HOSTNAME_RE.test(config.email.smtpHost))
        return "smtp-host-invalid";
      if (config.email.smtpPort && !VALID_SMTP_PORTS.includes(config.email.smtpPort))
        return "smtp-port-invalid";
    } else {
      if (
        config.email.resendKey &&
        config.email.resendKey !== "****" &&
        !RESEND_KEY_RE.test(config.email.resendKey)
      )
        return "resend-key-invalid";
    }
    if (config.email.fromAddress && !EMAIL_RE.test(config.email.fromAddress))
      return "from-address-invalid";
  }
  if (config.telegram.enabled) {
    if (
      config.telegram.botToken &&
      config.telegram.botToken !== "****" &&
      !TELEGRAM_TOKEN_RE.test(config.telegram.botToken)
    )
      return "telegram-token-invalid";
    if (config.telegram.chatId && !TELEGRAM_CHAT_ID_RE.test(config.telegram.chatId))
      return "telegram-chat-id-invalid";
  }
  if (config.whatsapp.enabled) {
    if (
      config.whatsapp.apiToken &&
      config.whatsapp.apiToken !== "****" &&
      !WHATSAPP_TOKEN_RE.test(config.whatsapp.apiToken)
    )
      return "whatsapp-token-invalid";
    if (config.whatsapp.phoneNumberId && !WHATSAPP_PHONE_ID_RE.test(config.whatsapp.phoneNumberId))
      return "whatsapp-phone-id-invalid";
  }
  return null;
}

// ── Secret field helpers ─────────────────────────────────────────────

export function emailHasSecrets(c: EmailConfig): boolean {
  return !!(c.smtpPass || c.smtpUser || c.smtpHost || c.resendKey || c.fromAddress);
}

export function telegramHasSecrets(c: TelegramConfig): boolean {
  return !!(c.botToken || c.chatId);
}

export function whatsappHasSecrets(c: WhatsAppConfig): boolean {
  return !!(c.apiToken || c.phoneNumberId);
}

export const EMAIL_BLANK: Partial<EmailConfig> = {
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPass: "",
  resendKey: "",
  fromAddress: "",
  fromName: "",
};
export const TELEGRAM_BLANK: Partial<TelegramConfig> = { botToken: "", chatId: "" };
export const WHATSAPP_BLANK: Partial<WhatsAppConfig> = { apiToken: "", phoneNumberId: "" };
