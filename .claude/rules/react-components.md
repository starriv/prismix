# React Component Rules

## Conventions

Files: `kebab-case.tsx`. Pages: `export default function`. Components: `export function`. Use `function` keyword, not arrows.
Import order: React hooks → i18n → third-party → `@/` absolute → relative.
Private helpers at bottom of page file, separated by `// ── Section ──`.
Icons: `lucide-react` only. Prop type: `LucideIcon`.

## Event Handlers

Wrap in `useCallback` or extract as named function. Exception: single-expression delegates in FormField render props.

❌ `<Input onChange={(e) => setValue(e.target.value)} />` — inline arrow with logic.

## Auth Contexts

Two distinct contexts, never mix: `useAuthContext()` (merchant) vs `useAdminAuthContext()` (admin).

## State

Server data → TanStack Query. Local UI → `useState`. No global store (no Redux/Zustand/Jotai).

❌ `useState` holding server data that should be a query.
❌ Copying query result into `useState` (stale copy).

## Filter + Pagination

Two-layer state: `draft*` (UI controls) + `applied*` (drives query). Search button copies draft → applied + `setPage(0)`. Enter triggers search. Reset clears both.
Page size: `DEFAULT_PAGE_SIZE` from `@/web/api/constants`. Pagination layout: `justify-between`, text labels, visible only when multi-page.

❌ Query bound to draft state directly.
❌ Filter applied immediately on Select change.
❌ Hardcoded page size numbers.

## Forms

`react-hook-form` + `@hookform/resolvers/zod`. Reuse schemas from `schemas.ts`. Radix Select/Switch: use `FormField` (Controller wrapper). Edit sheets: `defaultValues` from entity + `useEffect` → `form.reset()` on change.

## Zod Validation Messages

**Every** `.min()` / `.max()` / `.email()` / `.url()` / `.regex()` / `.refine()` that can surface to the user **must** pass an i18n key as message. `FormMessage` auto-translates keys containing `.` via `t()`.
Keys live under `common.valid.*` in both locale files. If no existing key fits, add a new one — never inline English.

| Instead of | Use |
|---|---|
| `.min(1)` | `.min(1, "common.valid.required")` |
| `.email()` | `.email("common.valid.invalid-email")` |
| `.url()` | `.url("common.valid.invalid-url")` |
| `"Name is required"` | `"common.valid.name-required"` |

❌ Bare Zod validators without i18n message (Zod defaults are English-only).
❌ Hardcoded English strings as validation messages.
❌ Manual `useState` per form field.
❌ Raw `FormData` or `onSubmit` without RHF.
