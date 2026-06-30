# AI Log Performance Probe Contract And Schema

Status: done
Priority: P0
Project: AI Log Performance Probes
Updated: 2026-06-30

## Why Now

The codebase already records `latency_ms`, but that field is not enough to diagnose slow upstreams, queueing, streaming first-byte delay, cache behavior, or retries. A stable schema must come first so instrumentation, API responses, and UI labels all use the same semantics.

## Goal

The database, repository layer, write queue handler, and web API schema support a backward-compatible AI log performance metric contract with clear definitions.

## Dependencies

- None

## Unlocks

- [AI relay performance probe instrumentation](task-ai-log-performance-probe-instrumentation.md)
- [AI log cache hit accounting and aggregate metrics](task-ai-log-performance-cache-aggregates.md)
- [AI log performance UI](task-ai-log-performance-ui.md)

## Execution Steps

- [x] Define canonical metric names and meanings for total latency, upstream TTFB, upstream body read, queue wait, cache lookup, first stream chunk, first token, request bytes, response bytes, stream chunks, stream bytes, attempt count, retry count, route type, stream flag, cache status, and stream abort reason.
- [x] Add a Drizzle migration for nullable `ai_usage_logs` performance columns so existing rows remain valid.
- [x] Update `src/server/db/schemas/pg.ts` to match the migration.
- [x] Extend the AI usage write handler in `src/server/ai/init.ts` so batched writes preserve the new fields.
- [x] Confirm `aiUsageLogRepo.findAll`, recent upstream queries, and count paths still return old and new rows without breaking filters.
- [x] Extend `aiUsageRecordSchema` in the web API schemas with nullable optional fields.
- [x] Add focused unit coverage for inserting and reading a log row with performance fields.

## Acceptance Criteria

### Step Acceptance Criteria

- The metric contract defines every new field in one place before the UI depends on it.
- The migration only adds backward-compatible nullable/defaulted columns.
- Old rows with null metrics are returned successfully through existing recent-log endpoints.
- New fields survive the write queue batch handler and repository reads.

### Task Completion Acceptance Criteria

- `ai_usage_logs` can persist the new performance metrics.
- API consumers can parse rows with or without the new fields.
- Focused tests cover at least one row with populated performance metrics and one legacy-shaped row.

## Discoveries And Adjustments

- The contract is implemented as typed columns rather than JSON so high-value fields such as `cacheStatus`, `upstreamTtfbMs`, `retryCount`, and stream abort reason can be filtered or aggregated later.
- `attemptCount` and `retryCount` use defaults of `1` and `0`; all other new diagnostic fields are nullable to preserve legacy rows.
- `aiUsageSummarySchema` defaults new aggregate fields to zero so older payload-shaped tests and clients continue to parse.

## Execution Log

- 2026-06-30: Created task. Current schema has `latency_ms`, provider prompt-cache token fields, and upstream identity but no phase-level timing fields.
- 2026-06-30: Added `AiLogPerformanceMetrics`, `AiRequestProbe`, sanitization/merge helpers, Drizzle schema fields, migration, API schema fields, and write-queue mapping.
- 2026-06-30: Added unit coverage for performance probe helper behavior and API schema compatibility with legacy and populated rows.
- 2026-06-30: Validation passed: `pnpm vitest run src/__tests__/unit/server/ai-performance-probe.test.ts src/__tests__/unit/web/ai-log-performance-schema.test.ts src/__tests__/unit/server/ai-usage-log-repo.test.ts src/__tests__/unit/server/ai-stream-proxy.test.ts`.

## Review

Done. Storage and API surfaces now accept old rows and fully populated performance rows without requiring backfill.

## Notes

Prefer typed columns over a single opaque JSON blob for frequently queried metrics such as TTFB, cache status, retry count, and stream abort reason.
