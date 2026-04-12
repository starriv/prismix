# Web Refactor Plan

> Generated: 2026-04-12 | Scope: `src/web/` (full review, no diff filter)
> Previous review: 2026-04-12 (15 findings, all resolved)

## Priority Legend

| Level | Meaning |
|-------|---------|
| **P0** | User-facing impact (performance, broken UX) |
| **P1** | Dev velocity (maintenance burden, silent bugs) |
| **P2** | Tech debt (rule violations, cleanup) |

---

## P0 -- User-Facing

_(none found)_

---

## P1 -- Dev Velocity

### 1. [NEW] Recharts (~200 kB) eagerly imported in 3 page modules

| File | Line | Symbols |
|------|------|---------|
| `src/web/pages/dashboard.tsx` | 18 | `Bar, BarChart, CartesianGrid, XAxis` |
| `src/web/pages/ai-usage.tsx` | 17 | `Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis` |
| `src/web/pages/user/index.tsx` | 18 | `Bar, BarChart, CartesianGrid, XAxis` |

- **Agent**: Performance
- **Issue**: Although these pages are `React.lazy()` at the route level, recharts is a top-level import *inside* each page module. The user dashboard (`user/index.tsx`) is the first page every end-user hits after login, putting recharts on the critical path. Vite either duplicates or creates a vendor chunk loaded whenever *any* chart page is visited.
- **Fix**: Extract chart sections into `lazy()` sub-components (e.g., `<LazyBarChart>`) so recharts splits into its own async chunk loaded only when a chart is actually rendered.

### 2. [NEW] God component: `api/hooks.ts` (1151 lines)

- **File**: `src/web/api/hooks.ts`
- **Agent**: Architecture
- **Issue**: Largest non-UI file in the codebase. Bundles every TanStack Query hook into a single module -- hard to navigate, test, and tree-shake.
- **Fix**: Split into domain-specific hook files (`ai-model-hooks.ts`, `wallet-hooks.ts`, `webhook-hooks.ts`) mirroring page directories.

### 3. [NEW] God component: `api/schemas.ts` (787 lines)

- **File**: `src/web/api/schemas.ts`
- **Agent**: Architecture
- **Issue**: Single Zod schema barrel. Changes to any one domain schema force re-parsing and re-exports of the entire file.
- **Fix**: Co-locate schemas with their hook files or split by domain (`ai-schemas.ts`, `wallet-schemas.ts`).

### 4. [NEW] God components -- 6 page files over 400 lines

| File | Lines | Key sub-components to extract |
|------|-------|-------------------------------|
| `src/web/pages/ai-keys.tsx` | 657 | `AiKeyRow`, create/edit dialogs |
| `src/web/pages/fiat-configs.tsx` | 550 | Create dialog, config cards |
| `src/web/pages/ai-usage.tsx` | 526 | Chart section, shared `StatusBadge`/`formatTokens`/`DailyTrendChart` |
| `src/web/pages/admin/dashboard.tsx` | 520 | `CreditDialog`, `StatusBadge`, stat sections |
| `src/web/pages/admin/networks.tsx` | 493 | `AddNetworkDialog` |
| `src/web/pages/admin/key-providers.tsx` | 456 | Create dialog, `StatusBadge`, transaction section |

- **Agent**: Architecture
- **Note**: Previous review's 5 god components (ai-models, login-strategies, wallet, notifications, notification-providers) were all resolved. These are 6 *different* files that have grown past the threshold.
- **Fix**: Extract sub-components into per-page directories (e.g., `src/web/pages/ai-keys/`). `ai-usage.tsx` also exports shared helpers consumed by 4 other files -- move those to `@/web/components/dashboard/` or `@/web/shared/`.

### 5. [NEW] Duplicated StatusBadge pattern (6+ implementations)

| File | Component |
|------|-----------|
| `src/web/pages/admin/withdraw-orders.tsx:367` | `WithdrawStatusBadge` |
| `src/web/pages/user/wallet/pending-withdrawals.tsx:121` | `WithdrawOrderStatusBadge` |
| `src/web/pages/admin/dashboard.tsx:420` | `StatusBadge` |
| `src/web/pages/admin/key-providers.tsx:160` | `StatusBadge` |
| `src/web/pages/pay-agents/status-badge.tsx:4` | `StatusBadge` |
| `src/web/pages/webhooks/webhook-helpers.tsx:284,310` | `EndpointStatusBadge`, `DeliveryStatusBadge` |

- **Agent**: Architecture
- **Issue**: All follow the same pattern: `match(status) -> { label, className } -> <Badge variant="outline" className={cn("text-xs", ...)}>`. The two withdraw-order variants are structurally identical with only different i18n key prefixes.
- **Fix**: Create a generic `<StatusBadge status={...} colorMap={...} />` in `@/web/components/dashboard/status-badge.tsx` that accepts a status-to-config map. Domain callers pass their own maps.

### 6. [NEW] `useState` duplicating query data -- stale copy anti-pattern (3 locations)

| File | Line | Issue |
|------|------|-------|
| `src/web/pages/settings/general-tab.tsx` | 120-124 | `markupDraft` seeded from `useAiDefaultMarkup()` via `useEffect` -- stale on first render, refetch overwrites edits |
| `src/web/pages/admin/networks.tsx` | 135 | `rpcDraft` initialized from `network.rpcUrl` prop -- parent refetch doesn't update local state |
| `src/web/pages/admin/login-strategies/saml-card.tsx` | 35 | `metadataUrl` initialized from `config.metadataUrl` prop -- same prop-to-state anti-pattern |

- **Agent**: Architecture
- **Fix**: Use `react-hook-form` with `defaultValues` + `form.reset()` on prop change, or use `key={entity.id}` to force remount.

---

## P2 -- Tech Debt

### 7. [RECURRING] Inline arrows in `.map()` loop rows (4 files)

| File | Lines | Closures/row |
|------|-------|-------------|
| `src/web/pages/ai-keys.tsx` | 381, 399, 416, 426 | 4 |
| `src/web/pages/notifications/channels-tab.tsx` | 123, 133, 142 | 3 |
| `src/web/pages/webhooks/index.tsx` | 138, 142, 147, 150, 157 | 5 |
| `src/web/pages/admin/withdraw-orders.tsx` | 175, 184 | 2 |

- **Agent**: Performance
- **Issue**: Closures created inside `.map()` on every render. Webhooks page is the densest at 5 allocations x N rows. Previous review flagged this pattern broadly (153 instances / 33 files); the low-hanging fruit in flat handlers was fixed, but loop-bound closures remain.
- **Fix**: Extract each row into a `React.memo`-ed component that receives stable handler refs as props.

### 8. [RECURRING] Duplicated pagination inline closures (4 files)

- **Files**: `user/wallet/pending-withdrawals.tsx`, `user/wallet/transaction-history.tsx`, `notifications/logs-tab.tsx`, `admin/withdraw-orders.tsx`
- **Agent**: Performance
- **Issue**: Identical `onClick={() => setPage((p) => Math.max(0, p - 1))}` / `setPage((p) => p + 1)` copy-pasted. Previous review flagged 5 files; partially fixed, 4 remain.
- **Fix**: Extract a shared `<Pagination>` component or `usePagination()` hook with stable `onPrev`/`onNext` callbacks.

### 9. [NEW] Inline `onChange` arrows on controlled inputs (5 occurrences)

| File | Line(s) | Input |
|------|---------|-------|
| `src/web/pages/user/login.tsx` | 154, 162, 173 | email, password, confirmPassword |
| `src/web/pages/user/wallet/deposit-dialog.tsx` | 129 | txHash |
| `src/web/pages/user/wallet/withdraw-dialog.tsx` | 104 | toAddress |
| `src/web/pages/settings/general-tab.tsx` | 172 | markupDraft |
| `src/web/pages/ai-logs/log-detail-helpers.tsx` | 62 | multi-statement copy handler |

- **Agent**: Performance
- **Issue**: New closures on every keystroke. Login page creates 3 closures per re-render on every character typed.
- **Fix**: Wrap in `useCallback`, or migrate to `react-hook-form`'s `register()` (already a project dependency). The multi-statement handler in `log-detail-helpers.tsx` should definitely be extracted.

### 10. [NEW] `new Set()` for deduplication instead of lodash-es (3 locations)

| File | Line |
|------|------|
| `src/web/pages/admin/tokens.tsx` | 66 |
| `src/web/pages/ai-models/index.tsx` | 20 |
| `src/web/pages/admin/tokens.tsx` | 232 |

- **Agent**: Architecture
- **Issue**: Project convention mandates `lodash-es` for collection operations. Previous review's `new Set()` findings (webhook dialogs, notifications) were fixed; these are in different files.
- **Fix**: Replace with `lodash-es` helpers (`keyBy` for lookup maps, or document `Set<number>` for toggle-UI state as an accepted exception).

### 11. [NEW] Missing `useCallback` on handlers (2 locations)

| File | Line | Handler |
|------|------|---------|
| `src/web/pages/admin/login-strategies/saml-card.tsx` | 41-48 | `handleToggle` |
| `src/web/pages/admin/networks.tsx` | 334-341 | `toggle` (in AddNetworkDialog) |

- **Agent**: Architecture
- **Issue**: Plain arrow functions inside component body, passed as props to child components. Recreated on every render.
- **Fix**: Wrap with `useCallback`.

---

## Clean Checks (passed)

| Check | Result |
|-------|--------|
| `: any` / `as any` / `@ts-ignore` | None found -- previous `zodResolver as any` findings resolved |
| `from "@/server"` in web code | No matches -- clean boundary |
| Raw `fetch(` outside client files | Only in `create-api-client.ts` -- correct |
| `"/api/"` outside constants.ts | All in `constants.ts` -- correct |
| `type="password"` outside login | Only in login pages -- correct |
| Empty catch blocks | None found |
| Commented-out code | None found |
| `switch` statements | None found |
| Code splitting (lazy pages in app.tsx) | All pages use `React.lazy()` -- correct |
| Global `staleTime` | Configured at 30s in `main.tsx` |
| `queryKey` centralization | All use `queryKeys` factory -- no inline literals |
| `lodash-es` imports | All 14 imports use `lodash-es` named imports |
| `.sort()` / `.toFixed()` | None found -- previous findings resolved |

---

## Resolved Since Last Review

All 15 items from the previous plan are confirmed resolved:

| Previous | Status |
|----------|--------|
| P1-1: HomePage eagerly imported | Fixed -- now lazy |
| P1-2: 5 god components (ai-models, login-strategies, wallet, notifications, notification-providers) | Fixed -- all split |
| P1-3: Near-identical logs pages | Fixed -- deduplicated |
| P1-4: Inline query key literals | Fixed -- all use `queryKeys` factory |
| P1-5: `as any` on zodResolver + `form: any` | Fixed -- proper typing |
| P2-6: Inline arrows (broad) | Partially fixed -- low-hanging fruit done, loop closures remain |
| P2-7: Pagination duplication (5 files) | Partially fixed -- 4 files remain |
| P2-8: `.sort()` instead of lodash-es | Fixed |
| P2-9: `new Set()` dedup (webhooks, notifications) | Fixed -- new occurrences in different files |
| P2-10: `.toFixed()` | Fixed |
| P2-11: Duplicated event merge toggle | Fixed |
| P2-12: Error-rate stat card duplicated | Fixed |
| P2-13: Hardcoded refresh URLs | Fixed |
| P2-14: Dead code BufferGeometry | Fixed |
| P2-15: Commented-out beacon | Fixed |

---

## Recommended Execution Order

1. **[P1-1]** Lazy-split recharts in 3 pages -- biggest perf win, measurable bundle reduction
2. **[P1-6]** Fix useState/query stale copy (3 locations) -- prevents silent data bugs
3. **[P1-5]** Deduplicate StatusBadge (6 impls) -- extract shared component, then use during god component splits
4. **[P1-2+3]** Split `hooks.ts` (1151 lines) + `schemas.ts` (787 lines) by domain -- unblocks cleaner page splits
5. **[P1-4]** Split 6 god page components -- largest effort, do incrementally per page
6. **[P2-8]** Extract shared `<Pagination>` component -- deduplicate 4 files
7. **[P2-7+9+10+11]** Loop closures, onChange handlers, Set/useCallback cleanups -- batch together during related page work
