import { describe, expect, it } from "vitest";

import { buildUpstreamHourlySeries, parseDbTimestamp } from "@/server/repos/ai-usage-log-repo";

describe("ai usage log repo timestamp helpers", () => {
  it("treats PostgreSQL timestamp strings without timezone as UTC", () => {
    expect(parseDbTimestamp("2026-04-13 02:00:00")?.toISOString()).toBe("2026-04-13T02:00:00.000Z");
    expect(parseDbTimestamp("2026-04-13T02:00:00.123")?.toISOString()).toBe(
      "2026-04-13T02:00:00.123Z",
    );
  });

  it("preserves explicit timezone offsets", () => {
    expect(parseDbTimestamp("2026-04-13 02:00:00+00")?.toISOString()).toBe(
      "2026-04-13T02:00:00.000Z",
    );
    expect(parseDbTimestamp("2026-04-13T10:00:00+08:00")?.toISOString()).toBe(
      "2026-04-13T02:00:00.000Z",
    );
  });

  it("treats Date objects from PostgreSQL timestamp columns as UTC wall-clock time", () => {
    expect(parseDbTimestamp(new Date(2026, 3, 13, 2, 0, 0))?.toISOString()).toBe(
      "2026-04-13T02:00:00.000Z",
    );
  });
});

describe("ai usage log repo hourly helpers", () => {
  it("normalizes hourly rows and fills missing buckets", () => {
    const series = buildUpstreamHourlySeries(
      [
        {
          hour: "2026-04-13 01:00:00",
          requests: "1",
          clientErrors: "0",
          serverErrors: "0",
          avgLatencyMs: "100",
        },
        {
          hour: "2026-04-13 02:00:00+00",
          requests: "2",
          clientErrors: "1",
          serverErrors: "0",
          avgLatencyMs: "450.5",
        },
        {
          hour: new Date(2026, 3, 13, 4, 0, 0),
          requests: 3,
          clientErrors: 0,
          serverErrors: 1,
          avgLatencyMs: 120,
        },
      ],
      4,
      new Date("2026-04-13T04:37:00.000Z"),
    );

    expect(series).toEqual([
      {
        hour: "2026-04-13T01:00:00.000Z",
        requests: 1,
        clientErrors: 0,
        serverErrors: 0,
        avgLatencyMs: 100,
      },
      {
        hour: "2026-04-13T02:00:00.000Z",
        requests: 2,
        clientErrors: 1,
        serverErrors: 0,
        avgLatencyMs: 451,
      },
      {
        hour: "2026-04-13T03:00:00.000Z",
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        avgLatencyMs: 0,
      },
      {
        hour: "2026-04-13T04:00:00.000Z",
        requests: 3,
        clientErrors: 0,
        serverErrors: 1,
        avgLatencyMs: 120,
      },
    ]);
  });
});
