# Design: Upstream-Owned Key Management

## Summary

The current backend is already close to an upstream-centric model:

- `ai_upstreams` is a global upstream table.
- `ai_upstream_assignments` attaches upstreams to providers with routing fields.
- `ai_keys.upstream_id` already binds a key to a specific upstream.
- Key create/update already validates that the upstream is assigned to the key's provider.

So if the goal is:

- stop treating "assign upstream to key" as the primary admin mental model
- and instead manage keys under upstream buckets inside a provider

then the change is mostly a UI re-organization.

However, if the goal is stronger:

- make the provider's official base URL become a first-class upstream
- remove the `null upstream_id = official` legacy behavior
- and manage keys from the global upstream page with no provider context

then it is not just a UI change. The runtime still depends on provider-level legacy behavior.

The recommended plan is:

1. Phase 1: provider-scoped upstream-owned key management
2. Phase 2: optional explicit official upstream normalization

Phase 1 gets the natural UX the product wants with minimal architectural churn.

## Current Architecture

### Data Model

Today the core model is:

```text
ai_providers
  ├─ provider config: baseUrl, apiFormat, authType, authConfig
  ├─ upstreamRoutingStrategy
  └─ loadBalanceStrategy

ai_upstreams
  ├─ global upstream entity
  ├─ name / baseUrl / kind / metadata / enabled
  └─ may be assigned to multiple providers

ai_upstream_assignments
  ├─ providerId + upstreamId (unique pair)
  ├─ priority / weight / enabled
  └─ provider-scoped routing config

ai_keys
  ├─ providerId (NOT NULL, FK CASCADE)
  ├─ upstreamId (nullable, FK SET NULL)
  ├─ ownerId (nullable, FK SET NULL → key_providers)
  └─ encrypted key material + weight + enabled
```

Important detail:

- `ai_keys.provider_id` is mandatory. Deleting a provider cascades to all its keys (legacy FK, exists today).
- `ai_keys.upstream_id` is optional. FK `SET NULL` on upstream deletion (legacy FK, exists today).
- `ai_keys.owner_id` links to `key_providers` (revenue-share partners), not to `ai_providers`.
- `upstream_id = null` currently means "use the provider default base URL".
- Deleting an assignment **deletes** all keys bound to that provider+upstream pair via `aiKeyRepo.deleteByProviderAndUpstream()` (application logic). Keys are upstream-specific and cannot be reused with a different upstream.
- Deleting the upstream entity itself nulls keys via legacy FK `SET NULL` (database constraint). This is a separate path that should eventually be aligned to also delete.

**Constraint for all future changes**: No new foreign keys. All referential integrity, cascading deletes, and nullification must be handled in application code (repos / route handlers). The existing FKs are legacy and will not be extended.

### Runtime Flow

Relay selection is currently:

1. Resolve provider from model.
2. Resolve upstream candidates from provider assignments (enabled assignment + enabled upstream).
3. Also append a **legacy candidate** from `provider.baseUrl` with `priority=1000` (lowest priority fallback).
4. Order candidates by `upstreamRoutingStrategy`:
   - `priority` (default): ascending priority → descending weight → name.
   - `weighted-random`: weighted shuffle.
5. For each candidate, call `pickKey(providerId, upstreamId)` from an in-memory key pool.
6. Key pool is cached as `"providerId:upstreamId"` (or `"providerId:legacy"` for null upstream).
7. Key selection uses `loadBalanceStrategy`: `round-robin` (SWRR, Nginx-style) or `random` (weighted).
8. Health-aware: keys with consecutive failures get exponential penalty (30s base, doubles, max 2min).

In practice that means:

- Non-legacy upstream key pools are `(providerId, upstreamId)`.
- Official/default key pools are `(providerId, null)` stored under cache key `"providerId:legacy"`.
- Under `priority` strategy, the legacy target is always tried last (`priority=1000`), which means official keys act as a fallback, not the primary path.

This is why the current UI has a key-level upstream selector with a `legacy` option.

### Admin UI Split

The UI is currently split across three pages:

- `ai-providers`: master-detail page. Detail view shows provider info + upstream assignment table (priority, weight, enabled per assignment). Assignment CRUD lives here.
- `ai-keys`: groups keys by `providerId` into `ProviderPoolCard` components. Each card is a flat list of keys; each key row has an inline upstream `Select` dropdown with `"legacy"` as default plus the provider's enabled assignments. No grouping by upstream within a provider.
- `ai-upstreams`: master-detail page. List view shows health/metric cards. Detail view shows reverse assignment list (which providers use this upstream) + recent requests. Does not list individual keys.

That split is functional, but not very natural for day-to-day operations. In particular, to understand "which keys serve a specific upstream for a specific provider", the admin must mentally cross-reference the keys page with the provider's assignment table.

## What Already Exists

The backend already supports most of the semantics needed for upstream-centric key management:

- A key can already be bound to a specific upstream.
- Assignment validation already exists on key create/update.
- Deleting an assignment already nulls keys back to provider default.
- Key pool invalidation already understands `(providerId, upstreamId)` scope.
- Usage logs already capture `upstreamId`, `upstreamName`, and `upstreamBaseUrl`.

This is enough to support a better management UX without changing the database.

## What Does Not Exist Yet

Three things are still legacy-shaped:

### 1. Official upstream is not a real upstream row

The "official" path is still represented as:

- `provider.baseUrl`
- `ai_keys.upstream_id = null`
- a virtual runtime target named `legacy`

So "official upstream" is not actually stored in `ai_upstreams`.

### 2. Upstreams do not truly own keys at global scope

A key still fundamentally belongs to a provider, because the provider owns:

- auth type
- auth config
- API format
- model catalog
- key load-balancing strategy

An upstream alone is not enough to relay a request.

That means a global upstream page cannot safely become the single source of truth for key CRUD unless provider context is still present.

### 3. Global upstream sharing complicates a pure upstream-owned UI

`ai_upstreams` is global and may be assigned to multiple providers.

So if a key is shown "under an upstream", the UI still needs to answer:

- under which provider?

This is another reason why provider-scoped upstream management is the safer first step.

## Recommendation

The recommended path is to ship a provider-scoped UX first, and only normalize the official upstream into a real entity if the product later needs that stronger guarantee.

### Phase 1: Provider-Scoped Upstream-Owned Key Management

#### Product shape

Keep provider as the top-level domain object, but make upstream the primary grouping inside provider management.

New mental model:

```text
Provider
  ├─ Official upstream (virtual)
  │    ├─ key A
  │    ├─ key B
  │    └─ key C
  ├─ OpenRouter upstream
  │    ├─ key D
  │    ├─ key E
  │    ├─ key F
  │    └─ key G
  └─ Custom upstream
       ├─ key H
       └─ key I
```

In this phase:

- "official upstream" remains virtual
- `upstreamId = null` still means official/default
- routing and persistence do not change

#### Why this fits the current architecture

This matches the current backend exactly:

- provider-scoped key pools already exist
- provider-scoped upstream assignments already exist
- official/default is already a provider-scoped null-upstream pool

So the backend model does not need to change to support this UX.

#### UI proposal

Replace the current separation of:

- provider upstream assignment table
- global key page with per-key upstream selector

with a provider detail page that renders upstream buckets.

Each bucket should show:

- upstream name
- routing controls
- enabled state
- key count
- keys bound to this upstream
- add key button
- move key action

Recommended bucket types:

1. Official bucket
   - virtual row derived from `provider.baseUrl`
   - contains keys where `upstreamId = null`

2. Assigned upstream buckets
   - one bucket per `ai_upstream_assignment`
   - contains keys where `key.upstreamId = assignment.upstream.id`

#### API approach

There are two viable implementation options.

##### Option A: frontend-only composition (current baseline)

Reuse existing APIs:

- `GET /api/admin/ai/providers`
- `GET /api/admin/ai/providers/:id/upstreams`
- `GET /api/admin/ai/keys`

The client filters keys by `providerId` and groups them by `upstreamId ?? "official"`.

**Note**: The current `ai-keys` page already does this grouping by `providerId` and provides a per-key upstream selector. Phase 1 Option A is not new API work — it is a frontend re-grouping of data that is already fetched. The change is: replace the flat key list with per-key upstream dropdown → upstream bucket sections each containing their keys.

##### Option B: add a provider upstream-pools endpoint

Add a dedicated provider-scoped endpoint, for example:

`GET /api/admin/ai/providers/:id/upstream-pools`

Response shape:

- provider info
- one virtual official bucket
- assigned upstream buckets
- key counts and key lists per bucket

This is cleaner for the client and avoids repeated client-side grouping logic.

The backend work is still small because it is only aggregation over data that already exists.

#### Changes Needed

##### Frontend

Medium.

- Rework provider detail page to render upstream buckets instead of only an assignment table.
- Let "Add key" originate from a bucket so `providerId` and `upstreamId` are pre-filled.
- Replace inline "assign upstream to key" with "move key to another bucket".
- Optionally demote the standalone `ai-keys` page into an inventory/debug page.

Open interaction design decisions (not yet specified):

- **Move key**: dropdown selector per key, or a dialog with bucket target? Drag-and-drop is not recommended given the existing shadcn/Radix stack.
- **Empty buckets**: should upstream buckets with 0 keys still be visible? Recommended yes — shows the upstream is assigned but has no keys, which is useful operational signal.
- **Add key from bucket**: should open a dialog with `providerId` and `upstreamId` pre-filled. The current `AddKeyDialog` already accepts these as form fields — the change is auto-populating them.
- **Key sort within bucket**: recommend `weight desc → lastUsedAt desc → name asc` to match the runtime selection order.
- **Owner display**: `key_providers` (revenue-share partners) should remain visible per key row inside buckets, not be hidden by the bucket reorganization.

##### Backend

Small or none.

Needed only if we want a dedicated aggregate endpoint.

##### Database

None.

##### Relay / runtime

None.

#### Advantages

- Natural admin mental model
- No migration
- No relay risk
- Fast to ship
- Easy rollback

#### Limitation

Official upstream is still virtual, not a real `ai_upstreams` row.

That is acceptable if the goal is better management UX, but it is not a full architectural unification.

### Phase 2: Explicit Official Upstream Normalization

This phase is only needed if we want to fully say:

- every key belongs to an upstream
- official is just another upstream
- `upstreamId = null` is no longer a meaningful runtime state

#### Proposed model

For each provider, create one explicit official upstream row and one assignment:

```text
Provider "openai"
  ├─ Official upstream row: kind=official, baseUrl=provider.baseUrl
  ├─ OpenRouter upstream row
  └─ Custom upstream row
```

Important note:

- official upstreams should still be provider-specific rows
- they should not be globally shared by default

Even though upstreams are globally modeled, the official upstream for one provider is not semantically interchangeable with another provider because auth and model semantics remain provider-owned.

#### Required changes

##### Data migration

- Create one official upstream row per provider.
- Create one provider -> upstream assignment for each official row.
- Backfill `ai_keys.upstream_id = officialUpstreamId` for rows currently using `NULL`.
- No new FKs. The new official upstream rows and assignments are linked by application logic only. Deletion cascades, orphan cleanup, and integrity checks must be enforced in repos and route handlers.

##### Runtime

- Stop auto-appending the legacy runtime target from `provider.baseUrl`.
- Resolve only explicit assignments.
- Decide whether `provider.baseUrl` remains:
  - as a compatibility copy of the official upstream URL
  - or as a deprecated field written from official upstream state

**Cache migration risk**: The key-balancer caches pools under `"providerId:upstreamId"` and `"providerId:legacy"`. After migration:

- All `"providerId:legacy"` cache entries become stale and must be invalidated.
- New entries will use `"providerId:officialUpstreamId"`.
- During a rolling deploy, old instances may still write `"providerId:legacy"` keys while new instances write `"providerId:officialUpstreamId"`, causing duplicate pools. Mitigation: invalidate all key pool caches as part of the migration, and ensure the cache TTL (currently 30s for upstream candidates) is shorter than the deploy window.

##### API

- Key creation should default to the provider's official upstream ID, not `null`.
- Assignment deletion rules need a special case for official upstream:
  - probably do not allow deleting the provider's official assignment
  - or require replacing it first
- All referential integrity enforced in application code — no FK constraints on new or modified columns. Orphan prevention, cascade deletes, and nullification are repo/handler responsibilities.

##### Seeding / bootstrap

- provider creation or provider seed must also create the official upstream assignment automatically

##### Observability

- upstream overview will now include official upstreams as real rows
- keys currently hidden under `null upstream` will become visible in upstream-level stats

#### Change Size

Frontend: medium

Backend: medium

Database: medium

Runtime risk: medium

This is the point where the work stops being "just UI".

## Recommended Delivery Plan

### Step 1

Ship Phase 1 only.

This gets the desired UX quickly and uses the current backend as-is.

### Step 2

Observe whether operators still feel friction from the virtual official bucket.

If the answer is no, stop here.

### Step 3

Only do Phase 2 if one of these becomes important:

- global upstream page must manage official keys directly
- upstream analytics must include official traffic as first-class rows
- the product wants to eliminate `null upstream` semantics completely

## Concrete Scope Assessment

If the requested change is interpreted as:

- "inside a provider, manage keys under official / OpenRouter / custom upstream buckets"

then the answer is:

- yes, mostly UI
- backend is largely already there

If the requested change is interpreted as:

- "official upstream should become a real upstream entity everywhere in the system"

then the answer is:

- no, not just UI
- backend and runtime still have legacy provider-default behavior to remove

## Implementation Notes

### Recommended first release

For the first release:

- keep `ai_keys.upstream_id = null` as official/default
- add provider-scoped upstream buckets in the provider detail page
- keep the existing global upstream health page
- keep current key CRUD routes
- optionally add one aggregate endpoint if the client becomes too awkward

### Suggested page ownership

- `ai-providers` becomes the main operational page
- `ai-upstreams` remains inventory / health / diagnostics
- `ai-keys` becomes secondary, or can later be removed from primary navigation

This matches the current domain better than trying to make the global upstream page own keys.

## Open Questions

1. Do we actually use the same global upstream row across multiple providers in production?
   - **Architecture note**: The schema allows it (`ai_upstream_assignments` has a unique constraint on `(provider_id, upstream_id)`, not a unique on `upstream_id`). This is by design for shared resellers like OpenRouter that serve multiple provider formats. Verify actual usage with production data.

2. Do we want the `ai-keys` page to remain as an advanced inventory page?
   - **Recommendation**: Yes, keep as an inventory/debug view. It currently provides a cross-provider flat list that is useful for searching by key prefix, finding orphaned keys, and bulk operations. The provider-scoped bucket view cannot replace this use case.

3. If we later normalize official upstreams, should provider deletion also clean up the official upstream row, or should official upstreams be protected?
   - **Consideration**: Since no new FKs are allowed, provider deletion must handle cleanup in application code: delete the provider's keys, delete assignments, and optionally delete the official upstream row. The repo/handler must enforce the correct order. A `kind=official` marker on the upstream row can help the application identify which upstreams are provider-specific and safe to delete vs shared and must be preserved.

4. **New**: Under `priority` routing strategy, the legacy target has `priority=1000` (always last). Should the Phase 1 "Official" bucket UI surface this priority information to help admins understand that official keys are a fallback, not the primary path?

5. **New**: How should `key_providers` (owner/revenue-share partner) information be displayed in the bucket view? Current key rows show owner name as a badge. This should carry over into the bucket layout.

## Conclusion

The current backend is already strong enough for the UX change the product wants, as long as we keep the change provider-scoped.

So the best path is:

- Phase 1 now: UI reorganization around provider-scoped upstream buckets
- Phase 2 later: optional removal of legacy official/default behavior

That gives the natural "upstream owns keys" experience without forcing a risky runtime migration.
