import type { ClientFormat } from "@/server/ai/lib/client-format";
import { safeParseJsonArray } from "@/server/ai/lib/safe-json";
import type { StreamInitialEvent } from "@/server/ai/lib/stream-proxy";
import type { OpenAIChatBody, OpenAIChatResponse } from "@/server/ai/providers/types";
import type { Announcement } from "@/server/db";
import { log } from "@/server/lib/logger";
import { announcementDeliveryRepo, announcementRepo } from "@/server/repos";
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_SURFACES,
  type AnnouncementCategory,
  type AnnouncementSeverity,
  type AnnouncementSurface,
} from "@/shared/announcements";

// Re-exported for backward compatibility — single source lives in @/shared/announcements.
export {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_SURFACES,
  type AnnouncementCategory,
  type AnnouncementSeverity,
  type AnnouncementSurface,
};

export type ModelErrorReason = "not_allowed" | "not_found_or_disabled" | "no_route";

export interface AnnouncementNoticePayload {
  id: string;
  title: string;
  body: string;
  link: string | null;
  category: string;
  severity: string;
  surface: AnnouncementSurface;
}

function isAnnouncementSurface(value: string): value is AnnouncementSurface {
  return ANNOUNCEMENT_SURFACES.includes(value as AnnouncementSurface);
}

function parseSurfaces(announcement: Announcement): AnnouncementSurface[] {
  return safeParseJsonArray(announcement.surfaces, "announcement.surfaces").filter(
    isAnnouncementSurface,
  );
}

function parseRelatedModels(announcement: Announcement): string[] {
  return safeParseJsonArray(announcement.relatedModels, "announcement.relatedModels");
}

function hasSurface(announcement: Announcement, surface: AnnouncementSurface): boolean {
  return parseSurfaces(announcement).includes(surface);
}

function modelMatches(pattern: string, modelId: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return modelId.startsWith(pattern.slice(0, -1));
  return pattern === modelId;
}

function isRelatedToModel(announcement: Announcement, modelId: string): boolean {
  const relatedModels = parseRelatedModels(announcement);
  if (relatedModels.length === 0) return true;
  return relatedModels.some((pattern) => modelMatches(pattern, modelId));
}

function toNoticePayload(
  announcement: Announcement,
  surface: AnnouncementSurface,
): AnnouncementNoticePayload {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    link: announcement.link,
    category: announcement.category,
    severity: announcement.severity,
    surface,
  };
}

export function formatCliAnnouncementText(notice: AnnouncementNoticePayload): string {
  const lines = [`[Prismix Notice] ${notice.title}`, notice.body.trim()];
  if (notice.link) lines.push(`More: ${notice.link}`);
  return `${lines.filter(Boolean).join("\n")}\n\n`;
}

export function buildAnnouncementErrorPayload(
  payload: Record<string, unknown>,
  notice: AnnouncementNoticePayload | null,
): Record<string, unknown> {
  if (!notice) return payload;
  // Attach the notice as a structured `announcement` field only. Do NOT rewrite
  // `payload.error` — SDKs and consumer `catch` blocks match on the error
  // message, and appending notice text would break that matching. Clients that
  // want to surface the notice read `announcement` (title/body/link) directly.
  return {
    ...payload,
    announcement: notice,
  };
}

/**
 * Shared injection-safety check for a raw request body.
 * CLI notice text is prepended to assistant content, so it is only safe for
 * plain-text chat — never for tool calls, functions, or structured output.
 */
export function canInjectCliTextNoticeIntoBody(body: Record<string, unknown>): boolean {
  if (body.tools != null || body.tool_choice != null) return false;
  if (body.functions != null || body.function_call != null) return false;

  const responseFormat = body.response_format;
  if (responseFormat == null) return true;
  if (typeof responseFormat !== "object" || Array.isArray(responseFormat)) return false;

  const type = (responseFormat as Record<string, unknown>).type;
  return type == null || type === "text";
}

export function canInjectCliTextNotice(body: OpenAIChatBody): boolean {
  return canInjectCliTextNoticeIntoBody(body as unknown as Record<string, unknown>);
}

export function injectCliNoticeIntoChatResponse(
  response: OpenAIChatResponse,
  noticeText: string,
): OpenAIChatResponse | null {
  const first = response.choices[0];
  if (!first || typeof first.message?.content !== "string") return null;
  return {
    ...response,
    choices: response.choices.map((choice, index) =>
      index === 0
        ? {
            ...choice,
            message: {
              ...choice.message,
              content: `${noticeText}${choice.message.content ?? ""}`,
            },
          }
        : choice,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function injectCliNoticeIntoClientResponse(
  response: unknown,
  noticeText: string,
  clientFormat: "openai" | "anthropic",
): unknown | null {
  if (clientFormat === "openai") {
    if (!isRecord(response)) return null;
    return injectCliNoticeIntoChatResponse(response as unknown as OpenAIChatResponse, noticeText);
  }

  if (!isRecord(response) || !Array.isArray(response.content)) return null;
  const content = response.content.map((block) => (isRecord(block) ? { ...block } : block));
  const textBlockIndex = content.findIndex(
    (block) => isRecord(block) && block.type === "text" && typeof block.text === "string",
  );

  if (textBlockIndex >= 0) {
    const block = content[textBlockIndex] as Record<string, unknown>;
    block.text = `${noticeText}${block.text as string}`;
  } else {
    content.unshift({ type: "text", text: noticeText });
  }

  return { ...response, content };
}

export function buildOpenAiCliNoticeStreamEvent(
  modelId: string,
  noticeText: string,
): { event?: string; data: string } {
  return {
    data: JSON.stringify({
      id: `chatcmpl-notice-${crypto.randomUUID()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: noticeText },
          finish_reason: null,
        },
      ],
    }),
  };
}

/**
 * Build the SSE prelude events for a CLI notice in a streaming response.
 *
 * Passthrough responses forward raw provider SSE frames verbatim. The OpenAI
 * incremental format can be safely prepended (SDKs tolerate an early
 * assistant-content delta). The Anthropic native stream, however, requires a
 * strict `message_start` → `content_block_start` → `content_block_delta`
 * sequence owned by the upstream — injecting an isolated delta would corrupt
 * the SDK state machine and conflict with the upstream's own start events, so
 * Anthropic streaming notices are skipped (non-streaming Anthropic responses
 * are still handled by `injectCliNoticeIntoClientResponse`).
 *
 * Canonical (adapter) responses are unaffected: their OpenAI-format notice
 * chunk is translated to Anthropic frames by the output transformer, which
 * emits the required start events itself.
 */
export function buildCliNoticeStreamEvents(
  modelId: string,
  noticeText: string,
  clientFormat: ClientFormat,
): StreamInitialEvent[] | null {
  if (clientFormat === "anthropic") return null;
  return [buildOpenAiCliNoticeStreamEvent(modelId, noticeText)];
}

export async function findActiveAnnouncementsForSurface(
  surface: AnnouncementSurface,
  limit = 10,
): Promise<Announcement[]> {
  // Surface filtering is pushed down to SQL (see announcementRepo.findActiveSent).
  // The in-memory hasSurface() check is kept as a defensive correctness layer on
  // the already-filtered result set; it is no longer the primary filter.
  const rows = await announcementRepo.findActiveSent(limit, surface);
  return rows.filter((row) => hasSurface(row, surface)).slice(0, limit);
}

export async function findCliAnnouncementForConsumer(
  consumerKeyId: number,
): Promise<AnnouncementNoticePayload | null> {
  const rows = await findActiveAnnouncementsForSurface("cli", 20);
  if (rows.length === 0) return null;
  const deliveredIds = await announcementDeliveryRepo.findDeliveredAnnouncementIds(
    rows.map((row) => row.id),
    consumerKeyId,
    "cli",
  );
  const pending = rows.find((row) => !deliveredIds.has(row.id));
  return pending ? toNoticePayload(pending, "cli") : null;
}

export async function findModelErrorAnnouncement(
  modelId: string,
  _reason: ModelErrorReason,
): Promise<AnnouncementNoticePayload | null> {
  const rows = await findActiveAnnouncementsForSurface("model_error", 20);
  const matched = rows.find((row) => isRelatedToModel(row, modelId));
  return matched ? toNoticePayload(matched, "model_error") : null;
}

export async function markAnnouncementDelivered(
  notice: AnnouncementNoticePayload,
  consumerKeyId: number,
): Promise<void> {
  try {
    await announcementDeliveryRepo.markDelivered(notice.id, consumerKeyId, notice.surface);
  } catch (err) {
    log.gateway.warn(
      { err, announcementId: notice.id, consumerKeyId, surface: notice.surface },
      "Failed to mark announcement delivered",
    );
  }
}
