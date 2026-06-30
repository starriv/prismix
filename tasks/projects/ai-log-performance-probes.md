# AI Log Performance Probes

Status: done
Updated: 2026-06-30

## Why Now

AI gateway logs currently show tokens, cost, status, upstream identity, and one coarse latency value. That is not enough to explain slow requests, streaming stalls, semantic cache behavior, fallback retries, or provider prompt-cache efficiency. Operators need per-request probe data similar to sub2api-style logs so they can diagnose latency and cache behavior from the Prismix UI.

## Goal

Each AI request log exposes consistent performance diagnostics across admin relay, consumer relay, chat completions, passthrough, streaming, non-streaming, cache-hit, cache-miss, retry, and error paths.

## Key Path

1. Define a stable metric contract and add backward-compatible storage/API fields.
2. Instrument relay hot paths with one shared probe model.
3. Account for gateway semantic-cache hit/miss/bypass and aggregate hit-rate/latency metrics.
4. Render the new metrics in admin and user log surfaces without making tables unusable.
5. Validate DB migration, hot-path behavior, responsive UI, and browser console/network health.

## Acceptance

- Single request logs can show total latency, upstream TTFB, stream first chunk or TTFT, queue wait, retry count, cache status, request/response size, stream chunks/bytes, and provider prompt-cache tokens when available.
- Cache hits are counted as first-class usage log rows or otherwise included in aggregate cache hit rate without double-billing.
- Existing old log rows remain readable with missing metrics displayed as empty values.
- Aggregates expose cache hit rate and latency summaries by time window and upstream/model where practical.
- UI changes pass the repository's mandatory local browser verification on desktop and mobile.

## Current Tasks

- [AI log performance probe contract and schema](../tasks/task-ai-log-performance-probe-contract.md)
- [AI relay performance probe instrumentation](../tasks/task-ai-log-performance-probe-instrumentation.md)
- [AI log cache hit accounting and aggregate metrics](../tasks/task-ai-log-performance-cache-aggregates.md)
- [AI log performance UI](../tasks/task-ai-log-performance-ui.md)
- [AI log performance rollout validation](../tasks/task-ai-log-performance-rollout-validation.md)

## Execution Log

- 2026-06-30: Created project plan from current repo state. Existing `ai_usage_logs` stores coarse `latency_ms` plus provider prompt-cache token fields, and `stream-proxy` already computes first chunk latency in memory but does not persist it.
- 2026-06-30: Added nullable/defaulted performance columns, Drizzle migration `0021_ai_usage_performance_probes`, API schema fields, write-queue preservation, and aggregate summary fields.
- 2026-06-30: Instrumented admin relay, consumer relay, passthrough, stream completion, semantic cache hit/miss/bypass, queue wait, upstream TTFB/body, transform, billing, bytes, attempts, and retries.
- 2026-06-30: Added compact table rendering, summary metric cards, detailed performance probe section, English/Chinese labels, and shared formatting helpers for admin/user logs.
- 2026-06-30: Documented metric semantics and cache-hit billing behavior in `docs/architecture/ai-log-performance-probes.md`.
- 2026-06-30: Validation passed with focused relay/probe tests, full unit suite, typecheck, lint, migration, and desktop/mobile browser verification of `/en/admin/ai-logs`.
