---
name: review-server
description: "Backend code review for src/server/. 3 parallel agents: architecture, security+performance, engineering+scalability. Supports diff mode. Trigger: \"review server\", \"review backend\"."
metadata:
  argument-hint: "[diff] [architecture|security|engineering]"
---

# Review Server

Audit `src/server/` + `src/blockchain/` + `src/shared/` with 3 parallel agents. Plan only — no code changes. Output: `docs/server-refactor-plan.md`.

**Modes**: `diff` = only changed files vs main. Focus arg = single agent. Combinable: `/review-server diff security`.

**Scope**: `src/server/`, `src/blockchain/`, `src/shared/` only. Grep-first, Read only for context.

**Context** (embed in each agent):
```
Node.js + Hono + Drizzle ORM (PostgreSQL) + ioredis + pino. Domain modules: gateway, merchant, admin, auth, messaging.
Strategy pattern: db, cache, queue, rate-limit, events (interface + impl + barrel).
Rules: ts-pattern 3+ branches, lodash-es, @/shared/number.ts, pino only (no console.log),
repos only (no direct @/server/db), FK split (management=CASCADE, hot-path=no FK), updatedAt in every .set().
```

## Agent 1: Architecture & Patterns
Glob large files. Check: files > 300 lines (god files), `switch(` (ts-pattern), `console.log/error/warn`, `.sort(`/`.toFixed(` (lodash-es/number.ts), cross-domain imports, route importing `@/server/db` directly, 3+ repeated CRUD patterns across routes, over-abstraction (single-impl interfaces). Max 15 findings.

## Agent 2: Security & Performance
Grep vulnerability patterns. Check: routes missing auth session check, POST/PUT without `parseBody`, `Number(`/`parseInt(` without NaN check, `z.any()` in request schemas, hardcoded secret-like strings, `fetch(` with user URLs (SSRF), `eval(`/`new Function(`, `await` inside loops (N+1), `.findAll()` without limit, unbounded in-memory Maps/Sets. Read gateway handler for sequential await chains. Max 15 findings.

## Agent 3: Engineering & Scalability
Grep-first. Check: `: any`/`as any`/`@ts-ignore`, `JSON.parse(` without Zod, empty catch blocks, `.set(` missing `updatedAt`, dead exports never imported, commented-out code > 5 lines, in-memory state that breaks multi-instance (verify Redis fallback), fire-and-forget `.catch()` swallowing errors, non-idempotent background jobs. Max 15 findings.

## Merge

Deduplicate → classify P0 (security/data loss) / P1 (performance/architecture) / P2 (code quality) → if previous plan exists mark NEW vs RECURRING → write `docs/server-refactor-plan.md` → present summary, wait for confirmation.
