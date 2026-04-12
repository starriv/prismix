# Testing Rules

> **HIGHEST PRIORITY** — overrides all other rules when in conflict.

Every code change has tests AND passes before done. Tests are part of implementation, not follow-up.

Server change → unit tests (`pnpm test:unit`, `*.test.ts` in `src/__tests__/unit/`). New endpoint → also integration tests (`pnpm test:integration`). Bug fix → regression test.
Web change → E2E spec (`pnpm test:e2e`, `*.spec.ts` in `src/__tests__/e2e/`). Schema change → update `e2e/helpers/mock-api.ts`.

Mock external deps (`vi.fn()`, `vi.spyOn`, `vi.mock()`), don't skip tests. E2E: `getByRole()`/`getByText()` (no `data-testid`), `authedPage` fixture, `page.route()` for API mocks.

❌ Deferring tests to a follow-up task.
❌ Skipping/disabling a failing test instead of fixing root cause.
❌ Skipping tests because "it requires a live service" — mock it.
