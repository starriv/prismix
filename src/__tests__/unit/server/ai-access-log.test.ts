import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAccessLogErrorMessage, enqueueAiAccessLog } from "@/server/ai/lib/access-log";

const mockEnqueueJob = vi.fn();

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

describe("ai access log helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a multi-line error message when detail exists", () => {
    expect(buildAccessLogErrorMessage("Upstream returned 500", "provider exploded")).toBe(
      "Upstream returned 500\n\nprovider exploded",
    );
  });

  it("writes usage log and request log when request body is present", () => {
    enqueueAiAccessLog({
      requestId: "req-1",
      statusCode: 500,
      error: "boom",
      keyId: 1,
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      requestBody: '{"model":"claude"}',
      responseBody: '{"error":"boom"}',
    });

    expect(mockEnqueueJob).toHaveBeenNthCalledWith(
      1,
      "ai-usage-log",
      expect.objectContaining({
        requestId: "req-1",
        statusCode: 500,
        error: "boom",
        keyId: 1,
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
      }),
    );
    expect(mockEnqueueJob).toHaveBeenNthCalledWith(
      2,
      "ai-request-log",
      expect.objectContaining({
        requestId: "req-1",
        modelId: "claude-3-7-sonnet",
        requestBody: '{"model":"claude"}',
        responseBody: '{"error":"boom"}',
      }),
    );
  });

  it("only writes usage log when request body is absent", () => {
    enqueueAiAccessLog({
      requestId: "req-2",
      statusCode: 403,
      error: "forbidden",
    });

    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "ai-usage-log",
      expect.objectContaining({
        requestId: "req-2",
        statusCode: 403,
        error: "forbidden",
      }),
    );
  });
});
