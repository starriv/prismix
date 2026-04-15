# Database Rules

Drizzle ORM + PostgreSQL. All imports via barrel: `from "@/server/db"`.

## Identifier Policy

Separate internal identifiers from external identifiers.

- Internal primary keys: numeric `id`
- External/public identifiers: stable non-sequential IDs such as `uuid`

Use `id` for:

- table relationships
- joins
- JWT/session payloads
- internal mutations
- performance-sensitive service logic

Use external IDs such as `uuid` for:

- UI display/copy
- admin search/filter inputs
- public-facing references
- external support/debug workflows

Do not replace internal relational logic with public IDs unless there is an explicit architecture decision to do so.
The normal pattern is: resolve external ID -> internal `id` -> run existing business logic.

❌ Foreign keys pointing to `uuid` by default.
❌ Using sequential internal `id` as the default public-facing identifier.
❌ Mixing `id` and `uuid` arbitrarily across the same external workflow.

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

## Migration

Claude only modifies schema files (`src/server/db/schemas/`). **Never** run `drizzle-kit generate`, `drizzle-kit migrate`, `pnpm db:migrate`, or `pnpm db:reset`.

When a schema change requires migration, output a prominent warning:

> **🔴 Schema changed — manual migration required**
> Run `pnpm db:generate` then `pnpm db:migrate` (or `pnpm db:reset` for dev).

❌ Claude running any migration or DB reset command.
❌ Silently changing schema without the migration warning.

## Seed Data

All defaults via `deploy/seed/pg.sql` (`ON CONFLICT DO NOTHING`). DB empty = disabled + warn log.

❌ `buildDefaults()` or env var fallback functions in code.
