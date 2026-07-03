import { describe, expect, it } from "vitest";

import {
  buildDailyUsageSeries,
  buildErrorDailySeries,
  buildUpstreamHourlySeries,
  parseDbTimestamp,
} from "@/server/repos/ai-usage-log-repo";

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

describe("ai usage log repo daily helpers", () => {
  it("normalizes daily rows, calculates error rate, and fills missing dates", () => {
    const series = buildDailyUsageSeries(
      [
        {
          date: "2026-07-01",
          requests: "4",
          inputTokens: "1000",
          outputTokens: "250",
          totalTokens: "1250",
          cacheCreationInputTokens: "100",
          cacheReadInputTokens: "200",
          reasoningTokens: "50",
          estimatedCost: "0.0125",
          errorCount: "1",
        },
        {
          date: "2026-07-03 00:00:00",
          requests: 2,
          inputTokens: 300,
          outputTokens: 80,
          totalTokens: 380,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 40,
          reasoningTokens: 10,
          estimatedCost: "0.004",
          errorCount: 0,
        },
      ],
      3,
      new Date("2026-07-03T13:00:00.000Z"),
    );

    expect(series).toEqual([
      {
        date: "2026-07-01",
        requests: 4,
        inputTokens: 1000,
        outputTokens: 250,
        totalTokens: 1250,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 200,
        reasoningTokens: 50,
        estimatedCost: 0.0125,
        errorCount: 1,
        errorRate: 0.25,
      },
      {
        date: "2026-07-02",
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0,
        errorCount: 0,
        errorRate: 0,
      },
      {
        date: "2026-07-03",
        requests: 2,
        inputTokens: 300,
        outputTokens: 80,
        totalTokens: 380,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 40,
        reasoningTokens: 10,
        estimatedCost: 0.004,
        errorCount: 0,
        errorRate: 0,
      },
    ]);
  });

  it("clamps the daily series window to 90 days", () => {
    const series = buildDailyUsageSeries([], 365, new Date("2026-07-03T13:00:00.000Z"));

    expect(series).toHaveLength(90);
    expect(series[0]?.date).toBe("2026-04-05");
    expect(series.at(-1)?.date).toBe("2026-07-03");
  });

  it("returns a single bucket when days=1 (startDay === endDay)", () => {
    const series = buildDailyUsageSeries(
      [
        {
          date: "2026-07-03",
          requests: "5",
          inputTokens: "100",
          outputTokens: "20",
          totalTokens: "120",
          cacheCreationInputTokens: "0",
          cacheReadInputTokens: "0",
          reasoningTokens: "0",
          estimatedCost: "0.001",
          errorCount: "2",
        },
      ],
      1,
      new Date("2026-07-03T23:59:59.000Z"),
    );

    expect(series).toHaveLength(1);
    expect(series[0]?.date).toBe("2026-07-03");
    expect(series[0]?.requests).toBe(5);
    expect(series[0]?.errorRate).toBe(0.4);
  });

  it("fills all 7 buckets with zeros when rows are empty", () => {
    const series = buildDailyUsageSeries([], 7, new Date("2026-07-07T08:00:00.000Z"));

    expect(series).toHaveLength(7);
    expect(series.every((row) => row.requests === 0 && row.totalTokens === 0)).toBe(true);
    expect(series[0]?.date).toBe("2026-07-01");
    expect(series.at(-1)?.date).toBe("2026-07-07");
  });
});

describe("ai usage log repo error daily helpers", () => {
  it("normalizes error daily rows and fills missing dates", () => {
    const series = buildErrorDailySeries(
      [
        {
          date: "2026-07-01",
          clientErrors: "3",
          serverErrors: "1",
          totalErrors: "4",
        },
        {
          date: "2026-07-03 00:00:00",
          clientErrors: 2,
          serverErrors: 5,
          totalErrors: 7,
        },
      ],
      3,
      new Date("2026-07-03T13:00:00.000Z"),
    );

    expect(series).toEqual([
      {
        date: "2026-07-01",
        clientErrors: 3,
        serverErrors: 1,
        totalErrors: 4,
      },
      {
        date: "2026-07-02",
        clientErrors: 0,
        serverErrors: 0,
        totalErrors: 0,
      },
      {
        date: "2026-07-03",
        clientErrors: 2,
        serverErrors: 5,
        totalErrors: 7,
      },
    ]);
  });

  it("clamps the error daily series window to 90 days", () => {
    const series = buildErrorDailySeries([], 365, new Date("2026-07-03T13:00:00.000Z"));

    expect(series).toHaveLength(90);
    expect(series[0]?.date).toBe("2026-04-05");
    expect(series.at(-1)?.date).toBe("2026-07-03");
    expect(series.every((row) => row.totalErrors === 0)).toBe(true);
  });
});
