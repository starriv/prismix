import { describe, expect, it } from "vitest";

import {
  byteLength,
  mergePerformanceMetrics,
  sanitizePerformanceMetrics,
} from "@/server/ai/lib/performance-probe";

describe("ai performance probe helpers", () => {
  it("sanitizes nullable and non-finite metric fields", () => {
    expect(
      sanitizePerformanceMetrics({
        routeType: "chat",
        cacheStatus: "hit",
        upstreamTtfbMs: 10.6,
        firstChunkMs: Number.NaN,
        responseBytes: -3,
      }),
    ).toEqual({
      routeType: "chat",
      cacheStatus: "hit",
      upstreamTtfbMs: 11,
      responseBytes: 0,
    });
  });

  it("merges later performance metrics and ignores null overrides", () => {
    expect(
      mergePerformanceMetrics(
        { cacheStatus: "miss", upstreamTtfbMs: 120, retryCount: 0 },
        { cacheStatus: "hit", upstreamTtfbMs: null, retryCount: 1 },
      ),
    ).toEqual({
      cacheStatus: "hit",
      upstreamTtfbMs: 120,
      retryCount: 1,
    });
  });

  it("counts utf8 bytes for logged request and response bodies", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("中文")).toBe(6);
    expect(byteLength(null)).toBeNull();
  });
});
