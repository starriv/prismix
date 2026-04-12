# Prismix — Claude Rules

Detailed rules are in `.claude/rules/`. All rules are mandatory.

| File                         | Covers                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `rules/project-structure.md` | Directory layout, placement rules, file naming, Strategy pattern                     |
| `rules/typescript.md`        | Strict TS, import style, error handling                                              |
| `rules/react-components.md`  | Component structure, exports, context, state, forms, routing                         |
| `rules/styling.md`           | Tailwind v4, cn(), CVA variants, shadcn/Radix UI, Dialog/Sheet conventions           |
| `rules/i18n.md`              | t() usage, key naming, locale sync, interpolation                                    |
| `rules/api-layer.md`         | client/schemas/hooks, Zod parsing, TanStack Query, no raw fetch                      |
| `rules/server.md`            | Hono routes, auth middleware, async writes, cache invalidation                       |
| `rules/database.md`          | Drizzle ORM (PostgreSQL), query helpers, schema pattern                              |
| `rules/utilities.md`         | lodash-es (mandatory), number utils, date-fns                                        |
| `rules/env-vars.md`          | Env var sync: update all templates + detailed comments                               |
| `rules/deploy.md`            | Deploy sync triggers, lite/production directory structure                            |
| `rules/docs.md`              | Docs site: docs/public → site sync, page pattern, i18n keys                          |
| `rules/testing.md`           | Unit/integration/E2E test structure, mandatory pass before commit                    |
| `rules/crypto.md`            | No hardcoded salts, ENCRYPTION_SALT env var, domain tags, crypto.ts only             |
| `rules/pattern-matching.md`  | ts-pattern mandatory for 3+ branch logic, no switch/long if-else                     |
| `rules/postman.md`           | API endpoint changes must sync to Postman collection via `/sync-postman`             |
| `rules/detail-sheet.md`      | Detail Sheet (side panel) card-based grouping, hero card, icon sizing, list patterns |
| `rules/git.md`               | Squash-only merge to main, commit message format                                     |
