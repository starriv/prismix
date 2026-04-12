# Environment Variable Rules

When adding/changing env vars, update **all files in same commit**: `.env.example` (source of truth) + `.env.local` (dev defaults).

Every variable needs comment: purpose + format + how to obtain + default behavior.
Group by section headers (`# ── Auth / Security ──`). Required: uncommented blank. Optional: commented out.

❌ Env var in code but missing from `.env.example`.
❌ Variable without comment explaining purpose and format.
