# Server Refactor Plan

> Generated: 2026-04-12 | **ALL ITEMS FIXED** (P1 + P2)
>
> Audited: `src/server/`, `src/blockchain/`, `src/shared/`
>
> Agents: Architecture & Patterns, Security & Performance, Engineering & Scalability

---

## P1 — Critical (Security / Data Loss / Multi-Instance Breakage)

### 1. [SEC] Guardrail evaluation failure silently allows requests through

- **File**: `src/server/ai/routes/consumer-relay.ts:110`
- **Issue**: `catch { /* guardrails unavailable -- proceed */ }` — if guardrail config JSON is corrupted or DB throws, all requests bypass guardrails with no log entry. Fail-open security posture without observability.
- **Fix**: Log warning in catch block; consider fail-closed for critical guardrail types.

### 2. [SEC] Consumer relay catch-all forwards unvalidated body to upstream

- **File**: `src/server/ai/routes/consumer-relay.ts:415-421`
- **Issue**: `consumerRelay.all("/v1/*")` uses raw `c.req.json()` without Zod validation. Arbitrary unvalidated JSON forwarded directly to upstream providers.
- **Fix**: Add minimal Zod schema or at least validate top-level structure before forwarding.

### 3. [SEC] `JSON.parse` + bare `as` cast on guardrail rules (no Zod)

- **File**: `src/server/ai/routes/relay.ts:73`
- **Issue**: `JSON.parse(gc.rules) as GuardrailConfig["rules"]` — corrupted JSON structure silently bypasses guardrails or throws at runtime.
- **Fix**: Validate with Zod schema after `JSON.parse`.

### 4. [SEC] `JSON.parse` + bare `as` cast on model capabilities (no Zod)

- **File**: `src/server/ai/routes/admin-ai.ts:50-55`
- **Issue**: `parseJsonField` falls back to `{}` on error; call sites cast with `as string[]`. Corrupted `capabilities` field becomes `{}` pretending to be `string[]`.
- **Fix**: Define Zod schemas for each JSON column type; validate after parse.

### 5. [SEC] `JSON.parse` + bare `as` cast on fallback model IDs (no Zod)

- **File**: `src/server/ai/routes/relay.ts:423`
- **Issue**: `JSON.parse(primaryModel.fallbackModelIds) as string[]` — if column contains non-array JSON, the `for...of` loop silently breaks or throws (caught and swallowed on line 428).
- **Fix**: Validate with `z.array(z.string())` after parse.

### 6. [SEC] `PUT /profile` body not validated with Zod

- **File**: `src/server/user/routes/user.ts:40-46`
- **Issue**: Raw `c.req.json()` cast as `{ name?, avatar? }` instead of `parseBody`. `pick()` guards after the fact but if list drifts from schema, field injection is possible.
- **Fix**: Define Zod body schema; use `parseBody`.

### 7. [PERF] Unbounded `days` query param in admin usage endpoint

- **File**: `src/server/ai/routes/admin-ai.ts:630`
- **Issue**: `Number(c.req.query("days") ?? 30)` — no NaN guard or upper bound. `?days=999999` triggers expensive unbounded DB aggregation. User portal version correctly caps at 90.
- **Fix**: `Math.min(Number(query) || 30, 90)` like user portal.

### 8. [PERF] `userRepo.findAll()` returns entire table with no limit

- **File**: `src/server/repos/user-repo.ts:30-32`
- **Issue**: `db.select().from(users)` with no `.limit()`. Called by admin user listing — unbounded memory with thousands of users.
- **Fix**: Add pagination parameters or a reasonable default limit.

### 9. [MULTI] Semantic cache is in-memory only — no Redis backing

- **File**: `src/server/ai/lib/semantic-cache.ts:17`
- **Issue**: In-memory LRU `Map` (10K entries, potentially 100MB-1GB). Each instance has isolated cache — inconsistent hits, wasted memory. Comment says "Redis is Phase 4" — still unaddressed.
- **Fix**: Back with Redis. Use `CacheStore` strategy pattern already in the project.

### 10. [MULTI] Key balancer state is in-memory only

- **File**: `src/server/ai/lib/key-balancer.ts:46`
- **Issue**: Round-robin pools and `currentWeight` counters are per-instance. All instances converge on the same key simultaneously, defeating load balancing. `invalidateKeyPool()` only clears local Map.
- **Fix**: Move pool state to Redis or use distributed counter.

### 11. [MULTI] SSE listeners are in-memory only

- **File**: `src/server/lib/sse.ts:18`
- **Issue**: SSE client on instance A won't receive events emitted on instance B. Events must route through Redis Pub/Sub (event bus does this for domain events, but SSE delivery is local-only).
- **Fix**: Bridge SSE delivery through Redis Pub/Sub channel.

### 12. [MULTI] Gateway config reload failure silently resets config

- **File**: `src/server/lib/gateway-config.ts:182-185`
- **Issue**: `invalidateGatewayConfig()` catches reload failure and sets `cachedConfig = null` without logging. DB hiccup silently resets entire gateway config (rate limits, circuit breakers, timeouts) to defaults.
- **Fix**: Log error; retain stale config rather than resetting to null on failure.

---

## P1 — Architecture

### 13. [ARCH] `admin.ts` is 880 lines with 38 route handlers

- **File**: `src/server/admin/routes/admin.ts`
- **Issue**: Monolithic router covering users, admins, tokens, networks, auth-providers, notifications, announcements, wallet/withdrawals. Difficult to maintain and review.
- **Fix**: Split into sub-routers: `admin-users.ts`, `admin-networks.ts`, `admin-wallet.ts`, `admin-announcements.ts`, etc.

### 14. [ARCH] `admin-ai.ts` is 691 lines

- **File**: `src/server/ai/routes/admin-ai.ts`
- **Issue**: Handles providers, models, keys, settings, and price syncing in one file.
- **Fix**: Split by domain: `admin-providers.ts`, `admin-models.ts`, `admin-keys.ts`, `admin-settings.ts`.

### 15. [ARCH] `relay-keys.ts` route imports `@/server/db` directly

- **File**: `src/server/ai/routes/relay-keys.ts:9,37`
- **Issue**: Route runs raw `db.select().from(relayConsumerKeys)` — only route file that executes queries directly bypassing repo layer.
- **Fix**: Move queries to a repo; import from repo in route.

---

## P2 — Code Quality / Minor Issues

### 16. [ARCH] `consumer-relay.ts` god file (693 lines)

- **File**: `src/server/ai/routes/consumer-relay.ts`
- **Fix**: Extract billing logic and response assembly into separate modules.

### 17. [ARCH] `stream-proxy.ts` god file (502 lines)

- **File**: `src/server/ai/lib/stream-proxy.ts`
- **Fix**: Split per-provider stream adapters into separate files.

### 18. [ARCH] `body-schemas.ts` god file (486 lines)

- **File**: `src/server/lib/body-schemas.ts`
- **Fix**: Group schemas by domain (ai, admin, auth, user, wallet).

### 19. [SEC] 3 admin endpoints use raw `c.req.json()` without Zod

- **Files**:
  - `src/server/ai/routes/admin-ai.ts:666-670` — `PUT /settings/request-logging`
  - `src/server/ai/routes/admin-ai.ts:681-684` — `PUT /settings/default-markup`
  - `src/server/ai/routes/admin-ai.ts:357-358` — `POST /providers/:id/models/sync-prices/apply`
- **Fix**: Define Zod schemas for each; use `parseBody`.

### 20. [SEC] Admin relay catch-all forwards unvalidated body

- **File**: `src/server/ai/routes/relay.ts:265-271`
- **Issue**: Same pattern as P1 #2 but admin-only (lower exposure).
- **Fix**: Add minimal validation or passthrough flag.

### 21. [ARCH] `key-balancer.ts` imports `@/server/db` directly

- **File**: `src/server/ai/lib/key-balancer.ts:22-24`
- **Issue**: Runs raw queries bypassing repo abstraction.
- **Fix**: Move queries to `ai-key-repo.ts` or `ai-provider-repo.ts`.

### 22. [PERF] Multiple `findAll` repo methods without `.limit()`

- **Files**: `ai-provider-repo.ts`, `ai-key-repo.ts`, `pay-agent-repo.ts`, `network-repo.ts`
- **Fix**: Add default limit or pagination to all list-type repo methods.

### 23. [PERF] Unbounded `diffs` array in sync-prices preview

- **File**: `src/server/ai/routes/admin-ai.ts:309-344`
- **Fix**: Add limit to response; paginate if needed.

### 24. [DATA] `webhook_deliveries` missing `updatedAt` column

- **File**: `src/server/repos/webhook-delivery-repo.ts:38-51`
- **Issue**: `updateStatus()` `.set(...)` has no `updatedAt`. Schema has no `updatedAt` column — status transitions have no timestamp trail.
- **Fix**: Add `updatedAt` column to schema; include in `.set()`.

### 25. [TYPE] `DbAdapter` interface uses `: any` for all parameters

- **File**: `src/server/db/adapter.ts:13-34`
- **Issue**: Blanket `eslint-disable @typescript-eslint/no-explicit-any`. Erases type safety for all DB calls.
- **Fix**: Use Drizzle's concrete query builder types or generics.

### 26. [TYPE] `admin-repo.ts` transaction callback typed as `any`

- **File**: `src/server/repos/admin-repo.ts:46-47`
- **Fix**: Type `tx` parameter with Drizzle's transaction type.

### 27. [UTIL] `[...new Set()]` instead of `lodash-es` `uniqBy`

- **Files**:
  - `src/server/admin/routes/key-providers.ts:123,149`
  - `src/server/ai/routes/admin-ai.ts:436,444`
- **Fix**: Replace with `uniqBy` from `lodash-es`.

### 28. [UTIL] `.toFixed()` instead of `@/shared/number.ts`

- **File**: `src/server/jobs/refresh-litellm-pricing.ts:89`
- **Fix**: Use `removeTailingZero` or formatting function from `@/shared/number.ts`.

### 29. [ARCH] `admin.ts` imports `transaction` from `@/server/db`

- **File**: `src/server/admin/routes/admin.ts:4`
- **Fix**: Encapsulate transaction orchestration in repo or service functions.

### 30. [MULTI] `ruleStats` in-memory Map (rate limiter)

- **File**: `src/server/middleware/rate-limiter.ts:33`
- **Issue**: Per-instance stats never aggregated. Admin dashboard shows partial picture.
- **Fix**: Aggregate via Redis or document as per-instance only.

### 31. [OBS] `write-through-cache-store.ts` — 7 silent `.catch(() => {})`

- **File**: `src/server/cache/write-through-cache-store.ts:95,116,122,123,132,142,150`
- **Issue**: Redis errors silently swallowed. Transient failures invisible.
- **Fix**: Add `log.redis.warn(...)` inside each catch.

### 32. [OBS] `write-queue.ts` outer `.catch(() => {})` swallows errors

- **File**: `src/server/lib/write-queue.ts:107,125`
- **Fix**: `.catch((err) => log.queue.error({ err, name }, "Unexpected flush error"))`.

### 33. [MULTI] `litellm-pricing.ts` in-memory Maps per instance

- **File**: `src/server/ai/lib/litellm-pricing.ts:81-83`
- **Issue**: Each instance parses and holds its own pricing Maps. Correctness is fine (eventually consistent via Redis) but wastes memory at scale.
- **Fix**: Low priority — document as known trade-off or share parsed maps via Redis.

---

## Summary

| Severity | Count | Breakdown |
|----------|-------|-----------|
| **P1**   | 15    | 6 security, 3 performance, 3 multi-instance, 3 architecture |
| **P2**   | 18    | 3 architecture (god files), 4 security, 3 performance, 2 data/types, 2 utility, 2 observability, 2 multi-instance |
| **Total**| **33**|  |

### Top priorities (suggested order)

1. **Guardrails fail-open** (P1 #1) — silent security bypass
2. **Unvalidated request bodies** (P1 #2, #6 + P2 #19, #20) — input validation gaps
3. **`JSON.parse` without Zod** (P1 #3, #4, #5) — type safety on DB JSON columns
4. **Multi-instance state** (P1 #9, #10, #11, #12) — breaks correctness at scale
5. **Unbounded queries** (P1 #7, #8 + P2 #22) — resource exhaustion
6. **God files** (P1 #13, #14 + P2 #16-18) — maintainability
