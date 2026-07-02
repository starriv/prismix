# AI Relay Performance Probe Instrumentation

Status: done
Priority: P0
Project: AI Log Performance Probes
Updated: 2026-06-30

## Why Now

Relay timing is currently measured with scattered `Date.now()` calls, while streaming first-chunk data is only emitted to logger output. Without a shared probe, different routes can assign different meanings to the same metric.

## Goal

Admin relay and consumer relay produce consistent per-request performance metrics for chat completions and passthrough requests across streaming, non-streaming, retry, cache, and error paths.

## Dependencies

- [AI log performance probe contract and schema](task-ai-log-performance-probe-contract.md)

## Unlocks

- [AI log cache hit accounting and aggregate metrics](task-ai-log-performance-cache-aggregates.md)
- [AI log performance UI](task-ai-log-performance-ui.md)

## Execution Steps

- [x] Add a small `AiRequestProbe` helper that uses monotonic timing and exposes named marks plus a normalized snapshot for usage-log writes.
- [x] Instrument admin chat completion and admin passthrough paths with cache lookup, credential/route resolution, queue wait, upstream fetch-to-headers, response body read, transform, and total latency marks.
- [x] Instrument consumer chat completion and consumer passthrough paths with the same metric names and include billing/write-enqueue timing only when it affects user-visible latency.
- [x] Pass probe snapshots through `StreamRelayMeta`, `StreamCompleteCallback`, and `BillConsumerParams` without widening unrelated business logic.
- [x] Persist existing stream lifecycle stats from `stream-proxy`: first chunk latency, chunk count, total bytes, ping count if kept, and abort reason.
- [x] Track attempt count and retry count across fallback candidates, including retryable upstream failures and concurrency queue failures.
- [x] Ensure relay/upstream/cache/stream error responses enqueue usage/access logs with the metrics collected before the error.
- [x] Add focused tests or deterministic fakes for non-streaming success, streaming first chunk, retry fallback, and early error paths.

## Acceptance Criteria

### Step Acceptance Criteria

- Every relay route uses the same probe field names.
- `latencyMs` means request start to completed response or completed stream.
- TTFB is measured as request start to upstream response headers for non-cached upstream calls.
- Streaming first chunk is persisted for both adapter-transformed streams and passthrough streams.
- Retry count excludes the first attempt and increments only for additional upstream candidates.

### Task Completion Acceptance Criteria

- Logs written by admin relay, consumer relay, streaming relay, passthrough relay, and error paths include performance metrics when available.
- Cache bypass/miss rows do not report fake TTFB values.
- Existing billing behavior and request/response body logging behavior are unchanged except for additional metrics.

## Discoveries And Adjustments

- Stream completion already had lifecycle state for first chunk, chunk count, and bytes; the implementation now passes those values into `StreamCompleteCallback` and admin usage-log writes instead of recomputing them elsewhere.
- Non-streaming consumer billing includes `billingMs` in the persisted metrics because it affects response latency. Stream billing remains in the completion callback and records its own timing without delaying first response bytes.
- Early catalog/auth/model-list failures can still write access logs without a full relay probe because no upstream relay attempt has started yet; upstream-facing relay failures include the metrics collected up to the failure.
- A later metric credibility review found that `firstTokenMs` was being populated from the same raw stream-read mark as `firstChunkMs`. That is not a real protocol-level first-token probe, so new stream logs no longer write `firstTokenMs`.

## Execution Log

- 2026-06-30: Created task. `stream-proxy` already computes `firstChunkLatencyMs`, `chunkCount`, and `totalBytes` in lifecycle state, which should be reused instead of reimplemented.
- 2026-06-30: Added probe snapshots through admin relay, consumer relay, passthrough, stream proxy, and billing paths.
- 2026-06-30: Added stream callback metric assertions and fixed the existing stream resilience test to assert the new callback contract.
- 2026-06-30: Validation passed: relay, passthrough, stream proxy, consumer billing, focused probe, and full unit suites.
- 2026-06-30: Removed `firstTokenMs` from the hot-path performance payload because the current stream proxy only observes first upstream chunk bytes, not first decoded model token.

## Review

Done. The hot paths now share one metric contract while preserving existing billing and request-log behavior. `firstChunkMs` is the trustworthy streaming responsiveness metric until a protocol-aware first-token detector exists.

## Notes

Keep probe code small and explicit. This should be hot-path instrumentation, not a general tracing framework.
