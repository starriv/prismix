---
name: review-web
description: "Frontend code review for src/web/. 3 parallel agents: performance, architecture, engineering. Supports diff mode. Trigger: \"review web\", \"review frontend\"."
metadata:
  argument-hint: "[diff] [performance|architecture|engineering]"
---

# Review Web

Audit `src/web/` with 3 parallel agents. Plan only — no code changes. Output: `docs/web-refactor-plan.md`.

**Modes**: `diff` = only changed files vs main. Focus arg = single agent. Combinable: `/review-web diff performance`.

**Scope**: `src/web/` only. Exclude `src/web/components/ui/` from architecture (shadcn primitives). Grep-first, Read only for context.

**Context** (embed in each agent):
```
React 19 + Vite + TanStack Query v5 + react-hook-form + Zod + shadcn/ui + Tailwind v4. No SSR.
Rules: ts-pattern 3+ branches, lodash-es mandatory, @/shared/number.ts, draft/applied filter pattern,
DEFAULT_PAGE_SIZE from constants, useCallback for handlers, WalletAddress for addresses, SecretInput for secrets.
```

## Agent 1: Performance
Grep-first. Check: inline arrows in JSX event props (re-renders), static page imports in app.tsx (no lazy), heavy libs loaded eagerly (recharts, monaco), TanStack Query hooks missing staleTime, duplicate queryKeys, `from "lodash"` without -es. Max 15 findings.

## Agent 2: Architecture
Glob large files first. Check: files > 400 lines (god components), `switch(` (ts-pattern violation), `.sort(`/`new Set(` (lodash-es), `.toFixed(` (number.ts), 3+ duplicated UI patterns without shared component, useState duplicating query data. Max 15 findings.

## Agent 3: Engineering
Grep-first. Check: `: any`/`as any`/`@ts-ignore`, `from "@/server` (cross-boundary), `fetch(` outside client.ts (raw fetch), `"/api/` outside constants.ts (hardcoded URL), `type="password"` outside login (SecretInput), empty catch blocks, commented-out code. Max 15 findings.

## Merge

Deduplicate → classify P0 (user-facing) / P1 (dev velocity) / P2 (tech debt) → if previous plan exists mark NEW vs RECURRING → write `docs/web-refactor-plan.md` → present summary, wait for confirmation.
