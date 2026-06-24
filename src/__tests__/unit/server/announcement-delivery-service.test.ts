import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAIChatBody, OpenAIChatResponse } from "@/server/ai/providers/types";
import type { Announcement } from "@/server/db";
import {
  type AnnouncementNoticePayload,
  buildAnnouncementErrorPayload,
  buildCliNoticeStreamEvents,
  canInjectCliTextNotice,
  canInjectCliTextNoticeIntoBody,
  findCliAnnouncementForConsumer,
  formatCliAnnouncementText,
  injectCliNoticeIntoChatResponse,
  injectCliNoticeIntoClientResponse,
} from "@/server/lib/announcement-delivery-service";

// ── Mocks for findCliAnnouncementForConsumer (N+1 elimination) ──
const mockFindActiveAnnouncementsForSurface = vi.fn();
const mockFindDeliveredAnnouncementIds = vi.fn();

vi.mock("@/server/repos", () => ({
  announcementRepo: {
    findActiveSent: (...args: unknown[]) => mockFindActiveAnnouncementsForSurface(...args),
  },
  announcementDeliveryRepo: {
    findDeliveredAnnouncementIds: (...args: unknown[]) => mockFindDeliveredAnnouncementIds(...args),
    markDelivered: vi.fn().mockResolvedValue(undefined),
  },
}));

const NOTICE: AnnouncementNoticePayload = {
  id: "ann-1",
  title: "Model retirement",
  body: "gpt-old will be retired on July 1.",
  link: "https://status.example.com/ann-1",
  category: "model_retirement",
  severity: "critical",
  surface: "cli",
};

describe("announcement delivery service", () => {
  it("formats CLI notices as a text prelude", () => {
    expect(formatCliAnnouncementText(NOTICE)).toContain("[Prismix Notice] Model retirement");
    expect(formatCliAnnouncementText(NOTICE)).toContain("More: https://status.example.com/ann-1");
  });

  it("rejects unsafe CLI text injection requests", () => {
    const base = { model: "gpt-4.1", messages: [{ role: "user", content: "hi" }] };
    expect(canInjectCliTextNotice(base as OpenAIChatBody)).toBe(true);
    expect(
      canInjectCliTextNotice({ ...base, tools: [{ type: "function" }] } as OpenAIChatBody),
    ).toBe(false);
    expect(
      canInjectCliTextNotice({
        ...base,
        response_format: { type: "json_schema", json_schema: {} },
      } as OpenAIChatBody),
    ).toBe(false);
  });

  it("injects a notice into OpenAI chat completion content", () => {
    const response: OpenAIChatResponse = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "gpt-4.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello" },
          finish_reason: "stop",
        },
      ],
    };

    const injected = injectCliNoticeIntoChatResponse(response, "NOTICE\n\n");
    expect(injected?.choices[0]?.message.content).toBe("NOTICE\n\nhello");
    expect(response.choices[0]?.message.content).toBe("hello");
  });

  it("injects a notice into Anthropic text content", () => {
    const response = {
      type: "message",
      content: [{ type: "text", text: "hello" }],
    };

    const injected = injectCliNoticeIntoClientResponse(response, "NOTICE\n\n", "anthropic") as {
      content: Array<{ text?: string }>;
    };
    expect(injected.content[0]?.text).toBe("NOTICE\n\nhello");
  });

  it("attaches an announcement to model error payloads without rewriting error", () => {
    const payload = buildAnnouncementErrorPayload({ error: "Model not found" }, NOTICE);
    // error must stay intact so SDK/consumer error-message matching still works
    expect(payload.error).toBe("Model not found");
    expect(payload.announcement).toMatchObject({ id: "ann-1", surface: "cli" });
  });

  it("returns the payload unchanged when there is no notice", () => {
    const payload = buildAnnouncementErrorPayload({ error: "Model not found" }, null);
    expect(payload).toEqual({ error: "Model not found" });
    expect(payload.announcement).toBeUndefined();
  });
});

describe("canInjectCliTextNoticeIntoBody", () => {
  const base = { model: "gpt-4.1", messages: [{ role: "user", content: "hi" }] };

  it("accepts a plain-text passthrough-style body (Record, not OpenAIChatBody)", () => {
    expect(canInjectCliTextNoticeIntoBody({ ...base })).toBe(true);
  });

  it("rejects tool-bearing bodies", () => {
    expect(canInjectCliTextNoticeIntoBody({ ...base, tools: [{ type: "function" }] })).toBe(false);
    expect(canInjectCliTextNoticeIntoBody({ ...base, tool_choice: "auto" })).toBe(false);
  });

  it("rejects structured response_format", () => {
    expect(
      canInjectCliTextNoticeIntoBody({ ...base, response_format: { type: "json_schema" } }),
    ).toBe(false);
    expect(canInjectCliTextNoticeIntoBody({ ...base, response_format: { type: "text" } })).toBe(
      true,
    );
  });
});

describe("buildCliNoticeStreamEvents", () => {
  it("emits an OpenAI chunk event for openai client format", () => {
    const events = buildCliNoticeStreamEvents("gpt-4.1", "NOTICE\n\n", "openai");
    expect(events).toHaveLength(1);
    const parsed = JSON.parse(events![0].data);
    expect(parsed.object).toBe("chat.completion.chunk");
    expect(parsed.choices[0].delta.content).toBe("NOTICE\n\n");
  });

  it("returns null for anthropic streaming (native SSE cannot accept an isolated delta)", () => {
    expect(buildCliNoticeStreamEvents("claude-3-5", "NOTICE\n\n", "anthropic")).toBeNull();
  });
});

function makeAnnouncement(id: string): Announcement {
  return {
    id,
    title: `Title ${id}`,
    body: `Body ${id}`,
    link: null,
    category: "general",
    severity: "info",
    surfaces: JSON.stringify(["cli"]),
    relatedModels: JSON.stringify([]),
    startsAt: null,
    expiresAt: null,
    priority: 0,
    status: "sent",
    createdBy: "admin",
    createdAt: new Date("2026-01-01"),
    updatedAt: null,
    sentAt: new Date("2026-01-01"),
  } as unknown as Announcement;
}

describe("findCliAnnouncementForConsumer (single-query delivery lookup)", () => {
  beforeEach(() => {
    mockFindActiveAnnouncementsForSurface.mockReset();
    mockFindDeliveredAnnouncementIds.mockReset();
  });

  it("resolves the first undelivered announcement using one batched query", async () => {
    const rows = [makeAnnouncement("a1"), makeAnnouncement("a2"), makeAnnouncement("a3")];
    mockFindActiveAnnouncementsForSurface.mockResolvedValue(rows);
    // a1 already delivered → should return a2
    mockFindDeliveredAnnouncementIds.mockResolvedValue(new Set(["a1"]));

    const notice = await findCliAnnouncementForConsumer(42);

    expect(notice).toMatchObject({ id: "a2", surface: "cli" });
    // Regression guard for the N+1 loop: exactly one delivery lookup, not one per row.
    expect(mockFindDeliveredAnnouncementIds).toHaveBeenCalledTimes(1);
    expect(mockFindDeliveredAnnouncementIds).toHaveBeenCalledWith(["a1", "a2", "a3"], 42, "cli");
    // Regression guard for the over-fetch + in-memory filter: surface is pushed
    // down to SQL (limit 20 with surface="cli"), not limit 200 unfiltered.
    expect(mockFindActiveAnnouncementsForSurface).toHaveBeenCalledTimes(1);
    expect(mockFindActiveAnnouncementsForSurface).toHaveBeenCalledWith(20, "cli");
  });

  it("returns null when every candidate is already delivered", async () => {
    const rows = [makeAnnouncement("a1"), makeAnnouncement("a2")];
    mockFindActiveAnnouncementsForSurface.mockResolvedValue(rows);
    mockFindDeliveredAnnouncementIds.mockResolvedValue(new Set(["a1", "a2"]));

    const notice = await findCliAnnouncementForConsumer(42);

    expect(notice).toBeNull();
    expect(mockFindDeliveredAnnouncementIds).toHaveBeenCalledTimes(1);
  });

  it("returns null and skips the delivery query when no active announcements exist", async () => {
    mockFindActiveAnnouncementsForSurface.mockResolvedValue([]);

    const notice = await findCliAnnouncementForConsumer(42);

    expect(notice).toBeNull();
    expect(mockFindDeliveredAnnouncementIds).not.toHaveBeenCalled();
  });
});
