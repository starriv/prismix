/**
 * Telegram notification channel — sends via Telegram Bot API.
 * Uses the platform-level Bot Token from admin config.
 */
import { log } from "@/server/lib/logger";

import type { NotificationChannel, NotificationPayload } from "../channel";

export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram" as const;

  async send(
    target: string,
    payload: NotificationPayload,
    options?: { providerConfig: Record<string, unknown> },
  ): Promise<void> {
    const botToken = options?.providerConfig?.botToken as string | undefined;
    if (!botToken) throw new Error("Telegram Bot Token not configured");

    const text = `*${escapeMarkdown(payload.title)}*\n\n${escapeMarkdown(payload.body)}\n\n_${escapeMarkdown(payload.event)} • ${new Date(payload.timestamp).toISOString()}_`;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target,
        text,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API error (${res.status}): ${body}`);
    }

    log.notification.info({ target, event: payload.event }, "Telegram message sent");
  }

  validateTarget(target: string): string | null {
    // Telegram chat IDs are numeric (can be negative for groups)
    return /^-?\d+$/.test(target) ? null : "Chat ID must be a number (negative for groups)";
  }
}

/** Escape special MarkdownV2 characters */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
