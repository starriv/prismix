# Project Structure Rules

## Domain Module Imports

Gateway barrel: external code imports from `@/server/gateway` only. No cross-domain imports — share via `lib/`, `repos/`, `events/`.
Shared infra (`lib/`, `middleware/`, `repos/`, `cache/`, `queue/`, `events/`, `rate-limit/`) — any domain can import.

❌ Import gateway internals bypassing barrel.
❌ Merchant route importing admin internals (or vice versa).
❌ Route file importing `@/server/db` directly — use repos.
❌ `src/server/lib/` importing from `src/web/`.

## Placement

`src/shared/` = both server+web (no browser/Node deps). `src/web/shared/` = web-only. `src/web/components/ui/` = shadcn primitives, no business logic. `src/web/pages/` = one file per route + local sub-components at bottom.

## Strategy Pattern

Swappable infra (db, cache, queue, rate-limit, events): `interface.ts` + `impl.ts` + `index.ts` barrel. Consumers import from barrel only.
`DATABASE_URL` not set → throws. `REDIS_URL` not set → memory fallback.
