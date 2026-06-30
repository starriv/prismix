# AI Log Cache Hit Accounting And Aggregate Metrics

Status: done
Priority: P1
Project: AI Log Performance Probes
Updated: 2026-06-30

## Why Now

The semantic cache currently returns early on a hit, so cache hits are operationally invisible in usage-log aggregates. Provider prompt-cache token fields exist, but they are not exposed in the log schema or summarized as rates.

## Goal

Gateway semantic-cache hits, misses, and bypasses are visible in logs and aggregate metrics, and provider prompt-cache read/write efficiency can be measured from logged token fields.

## Dependencies

- [AI log performance probe contract and schema](task-ai-log-performance-probe-contract.md)
- [AI relay performance probe instrumentation](task-ai-log-performance-probe-instrumentation.md)

## Unlocks

- [AI log performance UI](task-ai-log-performance-ui.md)
- [AI log performance rollout validation](task-ai-log-performance-rollout-validation.md)

## Execution Steps

- [x] Define billing semantics for gateway semantic-cache hits so hit rows do not accidentally double-charge consumers.
- [x] Write a usage log row for semantic-cache hits or introduce an equivalent aggregate-safe event path.
- [x] Record `cacheStatus` as `hit`, `miss`, `bypass`, or `disabled` consistently across streaming and non-streaming paths.
- [x] Add aggregate queries for cache hit rate over recent windows and by upstream/model where data supports it.
- [x] Add aggregate queries for provider prompt-cache read/write token rates using `cache_read_input_tokens` and `cache_creation_input_tokens`.
- [x] Add latency aggregate fields where useful, such as average and p95 total latency and upstream TTFB.
- [x] Cover cache-hit and cache-miss accounting with focused unit tests.

## Acceptance Criteria

### Step Acceptance Criteria

- Cache hit rows can be distinguished from upstream-served rows.
- Cache hit accounting does not change consumer balance unless an explicit product decision says cached responses are billed.
- Aggregate hit rate has a defined denominator and excludes cache-bypassed stream requests when appropriate.
- Provider prompt-cache metrics are calculated from token counts, not inferred from semantic-cache status.

### Task Completion Acceptance Criteria

- Admin usage/log APIs can report cache hit rate and prompt-cache read/write rates.
- Cache hits are visible enough to explain why a request has no upstream TTFB.
- Tests prove cache-hit logging and aggregate denominators are correct.

## Discoveries And Adjustments

- Semantic-cache hit rows are zero-cost consumer usage rows. They make hit rate and request history visible without double-billing cached responses.
- Cache hit rate uses only `hit` and `miss` rows as the denominator. Stream/passthrough bypasses are visible as `bypass` but excluded from the hit-rate denominator.
- Provider prompt-cache read/write rates remain separate from gateway semantic-cache status and are derived from provider usage token fields.

## Execution Log

- 2026-06-30: Created task. Current semantic-cache hit path in consumer relay returns cached JSON directly and does not write an `ai_usage_logs` row.
- 2026-06-30: Added semantic-cache hit usage-log writes for consumer relay, cache hit logging for admin relay, and miss/bypass status recording across stream and passthrough paths.
- 2026-06-30: Extended usage summaries with cache hit/miss/bypass counts, cache hit rate, prompt-cache read/write token totals/rates, average latency, p95 latency, average TTFB, and p95 TTFB.
- 2026-06-30: Validation passed with `ai-usage-log-repo`, relay, consumer relay, and full unit tests.

## Review

Done. Cache behavior is now visible per request and in aggregate summaries without changing consumer billing semantics.

## Notes

Separate gateway semantic-cache metrics from provider prompt-cache metrics in names and UI copy. They answer different questions.
