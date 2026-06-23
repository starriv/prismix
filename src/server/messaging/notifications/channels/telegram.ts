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
    const chatId = target || (options?.providerConfig?.chatId as string | undefined);
    if (!chatId) throw new Error("Telegram Chat ID not configured");

    const targetError = this.validateTarget(chatId);
    if (targetError) throw new Error(targetError);

    const utcTimestamp = new Date(payload.timestamp).toISOString();
    const cstTimestamp = formatCstTimestamp(payload.timestamp);
    const text = [
      `*${escapeMarkdown("[Prismix.live] 事件关注")}*`,
      `*${escapeMarkdown(payload.title)}*`,
      escapeMarkdown(payload.body),
      [
        `${escapeMarkdown("事件")}: ${escapeMarkdown(payload.event)}`,
        `${escapeMarkdown("UTC")}: ${escapeMarkdown(utcTimestamp)}`,
        `${escapeMarkdown("CST(UTC+8)")}: ${escapeMarkdown(cstTimestamp)}`,
      ].join("\n"),
    ].join("\n\n");

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API error (${res.status}): ${body}`);
    }

    log.notification.info({ target: chatId, event: payload.event }, "Telegram message sent");
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

function formatCstTimestamp(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}
