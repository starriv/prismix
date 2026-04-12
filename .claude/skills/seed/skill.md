---
name: seed
description: "Manage database seed data (PostgreSQL). Trigger: \"seed\", \"add network\", \"add token\", \"update seed\"."
---

# Seed Data Manager

Single source of truth for all default data: `deploy/seed/pg.sql`.

## Steps

1. Read `deploy/seed/pg.sql` — understand current seed data and section structure
2. Determine the change from user request (add/remove/update network, token, config)
3. For networks/tokens: look up chain ID, contract address, explorer URL. **Ask user if unsure about contract addresses.**
4. Update `deploy/seed/pg.sql` — maintain section headers, column order, `ON CONFLICT DO NOTHING`
5. If tokens changed: sync `src/shared/tokens.ts` (KNOWN_ADDRESSES maps)
6. Report: table of changes (table, action, entry)

## Seed Categories

| Category | Table | Conflict Key |
|----------|-------|-------------|
| Networks | `supported_networks` | `chain_id` |
| Tokens | `allowed_tokens` | `(symbol, network)` |
| Facilitator | `global_settings` key `facilitator_config` | `(key)` |
| Auth providers | `global_settings` key `auth_providers` | `(key)` |
| Admins | `admins` + `identities` | `(address)` / `(provider, provider_account_id, user_role)` |

## Rules

- Every INSERT must be idempotent (`ON CONFLICT DO NOTHING`)
- No hardcoded defaults in code — seed SQL is the only source
- Contract addresses must be EIP-55 checksum or all-lowercase
- JSON values in `global_settings` must be valid escaped JSON strings
