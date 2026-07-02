import { describe, expect, it } from "vitest";

import {
  AiRequestProbe,
  byteLength,
  mergePerformanceMetrics,
  sanitizePerformanceMetrics,
} from "@/server/ai/lib/performance-probe";

// Fields the init.ts batch handler reads from the ai-usage-log job payload.
// If init.ts adds a new field, add it here — this test catches contract drift.
const EXPECTED_PAYLOAD_FIELDS = [
  "endpointCredentialId",
  "credentialId",
  "credentialOwnerId",
  "consumerKeyId",
  "userId",
  "supplierId",
  "endpointId",
  "modelId",
  "upstreamId",
  "upstreamName",
  "upstreamBaseUrl",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningTokens",
  "estimatedCost",
  "upstreamCost",
  "markupPercent",
  "latencyMs",
  "routeType",
  "isStream",
  "cacheStatus",
  "cacheLookupMs",
  "cacheWriteMs",
  "routingMs",
  "queueWaitMs",
  "upstreamTtfbMs",
  "upstreamBodyMs",
  "transformMs",
  "billingMs",
  "firstChunkMs",
  "firstTokenMs",
  "tokensPerSecond",
  "requestBytes",
  "responseBytes",
  "streamChunks",
  "streamBytes",
  "streamPingCount",
  "streamAbortReason",
  "attemptCount",
  "retryCount",
  "statusCode",
  "requestId",
  "error",
] as const;

describe("ai-usage-log payload contract", () => {
  it("sanitizePerformanceMetrics only produces keys in EXPECTED_PAYLOAD_FIELDS", () => {
    const probe = new AiRequestProbe({
      routeType: "chat",
      isStream: true,
      cacheStatus: "miss",
      cacheLookupMs: 5,
      cacheWriteMs: 3,
      routingMs: 10,
      queueWaitMs: 2,
      upstreamTtfbMs: 300,
      upstreamBodyMs: 50,
      transformMs: 1,
      billingMs: 8,
      firstChunkMs: 310,
      requestBytes: 1024,
      responseBytes: 4096,
      streamChunks: 12,
      streamBytes: 2048,
      streamPingCount: 2,
      streamAbortReason: "completed",
      attemptCount: 1,
      retryCount: 0,
    });
    const snapshot = probe.snapshot();
    for (const key of Object.keys(snapshot)) {
      expect(EXPECTED_PAYLOAD_FIELDS, `unexpected key: ${key}`).toContain(key);
    }
  });

  it("mergePerformanceMetrics only produces keys in EXPECTED_PAYLOAD_FIELDS", () => {
    const merged = mergePerformanceMetrics(
      {
        routeType: "chat",
        isStream: false,
        cacheStatus: "hit",
        cacheLookupMs: 2,
        requestBytes: 100,
      },
      { billingMs: 5, responseBytes: 200, attemptCount: 1, retryCount: 0 },
    );
    for (const key of Object.keys(merged)) {
      expect(EXPECTED_PAYLOAD_FIELDS, `unexpected key: ${key}`).toContain(key);
    }
  });

  it("cache-hit payload includes required fields", () => {
    const probe = new AiRequestProbe({ routeType: "chat", isStream: false });
    const cacheLookupMs = 3;
    const snapshot = probe.snapshot({
      routeType: "chat",
      isStream: false,
      cacheStatus: "hit",
      cacheLookupMs,
      requestBytes: byteLength('{"model":"x"}'),
      responseBytes: byteLength('{"id":"x"}'),
      attemptCount: 1,
      retryCount: 0,
    });
    expect(snapshot.routeType).toBe("chat");
    expect(snapshot.cacheStatus).toBe("hit");
    expect(snapshot.cacheLookupMs).toBe(3);
    expect(snapshot.requestBytes).toBe(13);
    expect(snapshot.responseBytes).toBe(10);
    expect(snapshot.attemptCount).toBe(1);
    expect(snapshot.retryCount).toBe(0);
  });

  it("stream payload includes stream-specific fields", () => {
    const probe = new AiRequestProbe({ routeType: "chat", isStream: true });
    const snapshot = probe.snapshot({
      routeType: "chat",
      isStream: true,
      firstChunkMs: 250,
      streamChunks: 50,
      streamBytes: 8192,
      streamPingCount: 3,
      streamAbortReason: "completed",
      attemptCount: 2,
      retryCount: 1,
    });
    expect(snapshot.firstChunkMs).toBe(250);
    expect(snapshot.streamChunks).toBe(50);
    expect(snapshot.streamAbortReason).toBe("completed");
    expect(snapshot.retryCount).toBe(1);
  });

  it("billing merge adds billingMs without dropping existing fields", () => {
    const probe = new AiRequestProbe({ routeType: "chat", isStream: false });
    probe.set({ upstreamTtfbMs: 300, routingMs: 10 });
    const billingMetrics = mergePerformanceMetrics(probe.snapshot(), {
      billingMs: 12,
      requestBytes: 1024,
      responseBytes: 2048,
    });
    expect(billingMetrics.upstreamTtfbMs).toBe(300);
    expect(billingMetrics.routingMs).toBe(10);
    expect(billingMetrics.billingMs).toBe(12);
    expect(billingMetrics.requestBytes).toBe(1024);
    expect(billingMetrics.responseBytes).toBe(2048);
  });

  it("sanitizePerformanceMetrics rejects non-finite and negative values", () => {
    const sanitized = sanitizePerformanceMetrics({
      upstreamTtfbMs: Number.NaN,
      firstChunkMs: Number.POSITIVE_INFINITY,
      responseBytes: -100,
      streamChunks: 5.7,
    });
    expect(sanitized.upstreamTtfbMs).toBeUndefined();
    expect(sanitized.firstChunkMs).toBeUndefined();
    expect(sanitized.responseBytes).toBe(0);
    expect(sanitized.streamChunks).toBe(6);
  });

  it("sanitizePerformanceMetrics preserves float values for non-integer fields", () => {
    const sanitized = sanitizePerformanceMetrics({
      tokensPerSecond: 38.7,
      routeType: "chat",
    });
    expect(sanitized.tokensPerSecond).toBe(38.7);
    expect(sanitized.routeType).toBe("chat");
  });

  it("sanitizePerformanceMetrics rejects NaN/Infinity for float fields", () => {
    const sanitized = sanitizePerformanceMetrics({
      tokensPerSecond: Number.NaN,
    });
    expect(sanitized.tokensPerSecond).toBeUndefined();

    const sanitized2 = sanitizePerformanceMetrics({
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    expect(sanitized2.tokensPerSecond).toBeUndefined();
  });
});
