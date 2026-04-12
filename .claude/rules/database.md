# Database Rules

Drizzle ORM + PostgreSQL. All imports via barrel: `from "@/server/db"`.

## Foreign Key Policy

Management tables (config/CRUD): **FK + CASCADE**. Hot-path tables (logs, transactions, refresh_tokens): **No FK**.
New table checklist: hot path / async queue / logs / polymorphic → No FK. Otherwise → FK + CASCADE.
Deletion: CASCADE handles management children. Manually delete non-FK rows before parent.

❌ FK on high-frequency append-only tables.
❌ Manually deleting rows CASCADE already handles.
❌ WHERE-clause column without an index.

## Timestamps

`createdAt` on ALL tables (last column, `$defaultFn`). `updatedAt` on tables with UPDATE ops (before `createdAt`).

❌ `.set()` call without `updatedAt: new Date()` — `$defaultFn` only fires on INSERT.

## Seed Data

All defaults via `deploy/seed/pg.sql` (`ON CONFLICT DO NOTHING`). DB empty = disabled + warn log.

❌ `buildDefaults()` or env var fallback functions in code.

After schema changes: remind user `pnpm db:reset`.
