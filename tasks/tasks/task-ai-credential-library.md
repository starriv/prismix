# AI Credential Library And Reusable Bindings

Status: done
Priority: P1
Project: AI Credential Library
Updated: 2026-06-29

## Why Now

Admins need to configure providers like DeepSeek once and reuse the same real API key across multiple compatible connectors. The repo now allows duplicate credential rows as a fallback, but the better operational model is to make credentials first-class reusable entities.

## Goal

Admins can create, inspect, enable, disable, delete, and reuse AI credentials from a standalone page, and connector credential pools can bind an existing credential without re-entering the secret.

## Dependencies

- None

## Unlocks

- Cleaner key rotation and auditing for shared provider credentials.
- Future per-credential usage analytics and safer deletion warnings.

## Execution Steps

- [x] Confirm current schema, API routes, hooks, and navigation points.
- [x] Add reusable credential binding support to frontend API hooks and schemas.
- [x] Create standalone AI credentials admin page with create, toggle, delete, and binding visibility.
- [x] Add admin route, sidebar entry, and i18n labels.
- [x] Update connector credential add dialog to support selecting an existing same-supplier credential or creating a new credential.
- [x] Add focused tests for existing credential binding and run validation.

## Acceptance Criteria

### Step Acceptance Criteria

- Credential list data can be combined with endpoint credential assignments to compute reference counts and binding labels.
- Existing credential binding posts directly to `POST /api/admin/ai/endpoint-credentials`.
- New credential creation still creates `ai_credentials` first and then creates the binding.
- UI copy is present in English and Chinese locales.
- Route and sidebar navigation expose the new page.

### Task Completion Acceptance Criteria

- Standalone AI credentials page works from `/admin/ai-credentials`.
- Connector credential pool dialog supports both "existing credential" and "new credential" flows.
- Existing tests still pass, and at least one regression test covers binding an existing credential.
- `tasks/index.md` and project page reflect final task status.

## Discoveries And Adjustments

- The latest repo already had `queryKeys.aiEndpointCredentialsAll`, so the implementation added the matching hook instead of introducing a new API route.
- `ai_endpoint_credentials` already has unique indexes per endpoint/upstream pool. The route now checks that condition before insert and returns a 409 instead of surfacing a database error.
- The credential page computes reference counts client-side from `GET /credentials` plus `GET /endpoint-credentials`, keeping the backend API surface small.
- Several unrelated files were already modified in the worktree; this task avoided reverting or rewriting them.

## Execution Log

- 2026-06-29: Created task. Current database model already separates `ai_credentials` from `ai_endpoint_credentials`, so the key implementation risk is frontend flow and correct cache invalidation rather than schema design.
- 2026-06-29: Added reusable credential hooks: create/update/delete credential, all endpoint credential assignments, and endpoint binding by existing credential id.
- 2026-06-29: Added `/admin/ai-credentials` page, nav entry, route, and English/Chinese copy.
- 2026-06-29: Updated connector credential dialog to prefer existing same-supplier credentials while preserving new credential creation.
- 2026-06-29: Added endpoint credential assignment tests for successful existing-credential binding and duplicate binding conflict.
- 2026-06-29: Validation passed: `pnpm vitest run src/__tests__/unit/server/admin-ai-credentials.test.ts`, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.

## Review

The task can be marked done. All execution steps and completion criteria are satisfied. No downstream dependency changes are required; future usage analytics and safer deletion policies are enabled by the new page and binding flow but are not blocking this task.

## Notes

Do not overwrite unrelated in-progress changes in API, i18n, model, and date-picker files.
