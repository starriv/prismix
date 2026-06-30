# AI Log Performance Rollout Validation

Status: done
Priority: P1
Project: AI Log Performance Probes
Updated: 2026-06-30

## Why Now

This feature touches the database, relay hot paths, async write queue, billing-adjacent consumer paths, and frontend log views. It needs explicit rollout validation so performance diagnostics do not destabilize request serving or billing.

## Goal

The performance probe feature is validated end to end with tests, migration checks, local browser verification, and documentation of metric semantics.

## Dependencies

- [AI log performance probe contract and schema](task-ai-log-performance-probe-contract.md)
- [AI relay performance probe instrumentation](task-ai-log-performance-probe-instrumentation.md)
- [AI log cache hit accounting and aggregate metrics](task-ai-log-performance-cache-aggregates.md)
- [AI log performance UI](task-ai-log-performance-ui.md)

## Unlocks

- Shipping the AI log performance probe feature.

## Execution Steps

- [x] Run focused unit tests for usage log repository, stream proxy, relay paths, consumer billing integration, and cache accounting.
- [x] Run `pnpm typecheck` and `pnpm lint`.
- [x] Run database migration locally and confirm old rows and new rows both read through recent-log endpoints.
- [x] Validate non-streaming, streaming, cache miss, and cache hit behavior through deterministic tests; use a synthetic local log row for populated UI drill-down.
- [x] Verify `/admin/ai-logs` with `pnpm verify:web -- --url <local-url> --role admin --expect-text "<visible text>"`.
- [x] Verify a mobile viewport for the log table and detail sheet.
- [x] Check browser console output and failed network requests.
- [x] Update architecture docs with final metric definitions and cache-hit billing semantics.
- [x] Update `tasks/index.md`, project page, and all completed task cards with execution logs and review notes.

## Acceptance Criteria

### Step Acceptance Criteria

- Every validation command has a recorded pass/fail result.
- Browser verification includes local URL, auth role, viewport, tested workflow, console result, and network result.
- Documentation defines each user-visible metric in terms of where it starts and stops.

### Task Completion Acceptance Criteria

- No known blocker remains for shipping the feature.
- The project dashboard and task cards reflect final status.
- Any residual risk is documented with a concrete follow-up or accepted rationale.

## Discoveries And Adjustments

- The local admin log route requires a language prefix; verification used `http://localhost:5189/en/admin/ai-logs`.
- Live provider traffic was not required for rollout validation. Deterministic unit tests cover relay/cache/stream paths, and a temporary synthetic local usage row verified populated UI rendering before cleanup.
- `pnpm lint` passes with existing warnings in unrelated files; no lint errors were introduced by this feature.

## Execution Log

- 2026-06-30: Created task. Local UI verification is required because the feature changes rendered log views.
- 2026-06-30: Generated and applied Drizzle migration `0021_ai_usage_performance_probes`.
- 2026-06-30: Focused tests passed: performance probe/schema/repo/stream proxy, relay passthroughs, consumer relay passthroughs, and consumer billing.
- 2026-06-30: Full unit suite passed: 79 files, 1031 tests.
- 2026-06-30: `pnpm typecheck`, `pnpm lint`, locale JSON parse, and `git diff --check` passed.
- 2026-06-30: Browser verification passed on desktop and mobile with admin storage state; manual Playwright click verified the detail sheet and request log response.
- 2026-06-30: Added `docs/architecture/ai-log-performance-probes.md` with metric definitions, cache denominator, and cache-hit billing semantics.
- 2026-06-30: Current-state audit re-ran `pnpm db:migrate`, full `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, locale JSON parse, `git diff --check`, desktop/mobile `pnpm verify:web`, and desktop/mobile Playwright detail-sheet clicks. Only existing lint warnings, dev-mode console notices, and verifier HEAD aborts remain.

## Review

Done pending user UI acceptance. No known implementation blocker remains; final acceptance still requires the user's explicit approval after local browser verification.

## Notes

Do not claim the web UI portion is accepted until the user explicitly approves it after local browser verification.
