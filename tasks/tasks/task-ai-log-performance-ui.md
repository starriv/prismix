# AI Log Performance UI

Status: done
Priority: P1
Project: AI Log Performance Probes
Updated: 2026-06-30

## Why Now

The log table currently shows one coarse latency column. Once backend probe metrics exist, operators need a compact table view and a detailed drill-down without making the log page too wide or hard to scan on mobile.

## Goal

Admin and user AI log views display the new performance and cache metrics with a compact list presentation and a complete detail panel.

## Dependencies

- [AI log performance probe contract and schema](task-ai-log-performance-probe-contract.md)
- [AI relay performance probe instrumentation](task-ai-log-performance-probe-instrumentation.md)
- [AI log cache hit accounting and aggregate metrics](task-ai-log-performance-cache-aggregates.md)

## Unlocks

- [AI log performance rollout validation](task-ai-log-performance-rollout-validation.md)

## Execution Steps

- [x] Update admin log columns to show compact latency diagnostics, such as total latency plus TTFB/TTFT when present.
- [x] Update user log columns with the same information while respecting existing mobile hidden-column behavior.
- [x] Add provider prompt-cache read/write token display to the token column or a dedicated compact cache column.
- [x] Add a performance detail section that shows a timeline of queue wait, cache lookup, upstream TTFB, upstream body read, first chunk/TTFT, retry count, stream chunks/bytes, and abort reason.
- [x] Add English and Chinese i18n labels for all new table and detail text.
- [x] Ensure old rows with null metrics render as `-` or the existing empty marker.
- [x] Verify the UI at one desktop viewport and one mobile viewport with real local browser checks.

## Acceptance Criteria

### Step Acceptance Criteria

- The log table remains readable without horizontal overflow beyond the existing table design.
- The detail panel contains every persisted probe metric that is useful for per-request diagnosis.
- Admin and user log surfaces share formatting helpers where practical.
- Missing metrics do not produce misleading zeros.

### Task Completion Acceptance Criteria

- `/admin/ai-logs` shows the new performance fields for admin users.
- User logs show appropriate non-sensitive performance fields.
- Browser verification covers desktop and mobile viewports, console errors, failed network requests, row click, and detail panel rendering.

## Discoveries And Adjustments

- `/admin/ai-logs` is language-prefixed in local dev; the verified route is `/en/admin/ai-logs`.
- The detail sheet is shared, so the performance probe section was added once and reused by admin/user log surfaces.
- A synthetic local dev log row with model `gpt-performance-probe` was inserted to verify populated metric rendering and detail-sheet drill-down, then removed after verification.
- Summary cards now label gateway semantic-cache hit rate separately from provider prompt-cache read rate. If the gateway cache has no eligible `hit + miss` rows, the hit-rate card displays `—` instead of a misleading `0%`.
- The detail sheet now conditionally renders only fields applicable to the current request path. Stream bypass rows do not show empty cache lookup/write, non-stream body/transform, duplicate response size, zero stream ping, or zero provider cache-token rows.

## Execution Log

- 2026-06-30: Created task. Current `LogDetail` is shared by admin and user log detail sheets, so detail rendering can be implemented once with role-sensitive inputs if needed.
- 2026-06-30: Added shared performance formatting helpers, compact latency/cache token table summaries, admin aggregate cards, and a detailed `Performance Probe` section.
- 2026-06-30: Added English and Chinese labels for summary cards, cache labels, and all detailed performance probe fields.
- 2026-06-30: Browser verification passed for `http://localhost:5189/en/admin/ai-logs` as admin at 1440x1000 and 390x844, including row click and performance detail rendering.
- 2026-06-30: Console/network review showed only expected dev-mode informational output and a verifier HEAD request aborted by the script; application API requests returned 200.
- 2026-06-30: Re-verified current worktree with a temporary populated performance log row. Desktop and mobile detail-sheet clicks both rendered `Performance Probe`, `Upstream TTFB`, and `Request Body`; the request-log API returned 200. Temporary DB/Redis data and admin storage state were cleaned afterward.
- 2026-06-30: Re-reviewed cache summary display after a production screenshot showed `0%`; changed local UI copy to `网关缓存命中率` / `供应商读缓存率` and verified unavailable gateway hit rate renders as `—` on desktop and mobile.
- 2026-06-30: Re-reviewed a user-log detail screenshot with many empty fields. Removed fake TTFT display, changed the table to show first chunk instead, hid inapplicable detail rows by request type, and verified `/zh/user/logs` desktop/mobile with a temporary stream bypass row before cleanup.

## Review

Done pending user acceptance. The UI is locally browser-verified, but repository policy requires explicit user approval before the web UI change is considered accepted.

## Notes

This is a web UI change and must follow the repository's mandatory browser verification rule before being presented as accepted.
