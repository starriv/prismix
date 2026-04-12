# Crypto Rules

All encryption through `encrypt()` / `decrypt()` from `@/server/lib/crypto`. No exceptions.

❌ Raw `crypto.createCipheriv` or inline PBKDF2 outside `crypto.ts`.
❌ Hardcoded salt prefixes in source code.
❌ Using server secret as salt (password == salt).

Env vars: `JWT_SECRET`, `ENCRYPTION_KEY` (optional, falls back to JWT_SECRET), `ENCRYPTION_SALT`. Generate: `pnpm generate-secrets`.

Key derivation: `PBKDF2(ENCRYPTION_KEY + ":" + domainTag, ENCRYPTION_SALT + ":" + domainTag, 100K, SHA-256, 256bit)`.
Domain tags are constant identifiers (not secrets): `"auth-provider-config"`, `"facilitator-config"`, `"agent-private-key"`, `merchant.uuid`.
