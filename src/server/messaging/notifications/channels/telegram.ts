/**
 * Telegram notification channel — sends via Telegram Bot API.
 * Uses the platform-level Bot Token from admin config.
 */
import { AppError, ChannelDeactivatedError, RateLimitError } from "@/server/lib/errors";
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
    if (!target) throw new Error("Telegram Chat ID not configured");

    const targetError = this.validateTarget(target);
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

    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: target,
          text,
          parse_mode: "MarkdownV2",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new AppError("Telegram request timed out", 504, "CHANNEL_TIMEOUT");
      }
      throw err;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        ok: false;
        error_code: number;
        description: string;
        parameters?: { retry_after?: number; migrate_to_chat_id?: number; scope?: string };
      } | null;

      if (body) {
        if (body.error_code === 429) {
          throw new RateLimitError((body.parameters?.retry_after ?? 1) * 1000);
        }
        if (body.error_code === 403) {
          throw new ChannelDeactivatedError(
            `Telegram 403: ${body.description}`,
            "telegram",
            target,
          );
        }
        if (body.error_code === 400) {
          if (isPermanentTargetError(body.description, body.parameters)) {
            throw new ChannelDeactivatedError(
              `Telegram 400: ${body.description}`,
              "telegram",
              target,
            );
          }
          throw new AppError(`Telegram 400: ${body.description}`, 400, "CHANNEL_BAD_REQUEST");
        }
        throw new AppError(
          `Telegram ${body.error_code}: ${body.description}`,
          body.error_code,
          "CHANNEL_ERROR",
        );
      }

      const raw = await res.text().catch(() => "");
      throw new AppError(`Telegram API error (${res.status}): ${raw}`, res.status, "CHANNEL_ERROR");
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

function isPermanentTargetError(
  description: string,
  parameters?: { migrate_to_chat_id?: number },
): boolean {
  const normalized = description.toLowerCase();
  return (
    normalized.includes("chat not found") ||
    normalized.includes("user not found") ||
    normalized.includes("bot was kicked") ||
    normalized.includes("bot is not a member") ||
    parameters?.migrate_to_chat_id !== undefined
  );
}
