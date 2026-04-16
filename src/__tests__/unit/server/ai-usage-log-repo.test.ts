import { describe, expect, it } from "vitest";

import { buildUpstreamHourlySeries } from "@/server/repos/ai-usage-log-repo";

describe("ai usage log repo hourly helpers", () => {
  it("normalizes hourly rows and fills missing buckets", () => {
    const series = buildUpstreamHourlySeries(
      [
        {
          hour: "2026-04-13 02:00:00+00",
          requests: "2",
          clientErrors: "1",
          serverErrors: "0",
          avgLatencyMs: "450.5",
        },
        {
          hour: new Date("2026-04-13T04:00:00.000Z"),
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
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        avgLatencyMs: 0,
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
