# Design: Upstream-Owned Credential Management

## Summary

The current backend is already close to an upstream-centric model:

- `ai_upstreams` is a global upstream table.
- `ai_upstream_assignments` attaches upstreams to endpoints with routing fields.
- `ai_endpoint_credentials.upstreamId` already binds a credential assignment to a specific upstream.
- Credential create/update already validates that the upstream is assigned to the credential's endpoint.

So if the goal is:

- stop treating "assign upstream to credential" as the primary admin mental model
- and instead manage credentials under upstream buckets inside an endpoint

then the change is mostly a UI re-organization.

However, if the goal is stronger:

- make the endpoint's official base URL become a first-class upstream
- remove the `null upstreamId = official` legacy behavior
- and manage credentials from the global upstream page with no endpoint context

then it is not just a UI change. The runtime still depends on endpoint-level legacy behavior.

The recommended plan is:

1. Phase 1: endpoint-scoped upstream-owned credential management
2. Phase 2: optional explicit official upstream normalization

Phase 1 gets the natural UX the product wants with minimal architectural churn.

## Current Architecture

### Data Model

Today the core model is:

```text
ai_supplier_connections
  ├─ endpoint config: supplierId, baseUrl, apiFormat, authType, authConfig
  ├─ upstreamRoutingStrategy
  └─ loadBalanceStrategy

ai_upstreams
  ├─ global upstream entity
  ├─ name / baseUrl / kind / metadata / enabled
  └─ may be assigned to multiple endpoints

ai_upstream_assignments
  ├─ endpointId + upstreamId (unique pair)
  ├─ priority / weight / enabled
  └─ endpoint-scoped routing config

ai_credentials
  ├─ supplierId (nullable, FK SET NULL → ai_suppliers)
  ├─ ownerId (nullable, FK SET NULL → key_providers)
  └─ encrypted key material (encryptedKey, keyHash, keyPrefix)

ai_endpoint_credentials
  ├─ endpointId (NOT NULL, FK CASCADE → ai_supplier_connections)
  ├─ upstreamId (nullable, FK SET NULL → ai_upstreams)
  ├─ credentialId (NOT NULL, FK CASCADE → ai_credentials)
  ├─ weight / enabled
  └─ endpoint-scoped credential assignment
```

Important detail:

- `ai_endpoint_credentials.endpointId` is mandatory. Deleting an endpoint cascades to all its credential assignments (FK CASCADE).
- `ai_endpoint_credentials.upstreamId` is optional. FK `SET NULL` on upstream deletion.
- `ai_credentials.ownerId` links to `key_providers` (revenue-share partners), not to `ai_supplier_connections` or `ai_suppliers`.
- `upstreamId = null` currently means "use the endpoint default base URL".
- Deleting an assignment **deletes** all credential assignments bound to that endpoint+upstream pair via `aiEndpointCredentialRepo.deleteByEndpointAndUpstream()` (application logic). An assignment is upstream-specific within an endpoint and cannot be reused with a different upstream without a new assignment row.
- Deleting the upstream entity itself nulls credential assignments via FK `SET NULL` (database constraint). This is a separate path that should eventually be aligned to also delete.

**Constraint for all future changes**: No new foreign keys. All referential integrity, cascading deletes, and nullification must be handled in application code (repos / route handlers). The existing FKs are legacy and will not be extended.

### Runtime Flow

Relay selection is currently:

1. Resolve endpoint from model.
2. Resolve upstream candidates from endpoint assignments (enabled assignment + enabled upstream).
3. Also append a **legacy candidate** from `endpoint.baseUrl` with `priority=1000` (lowest priority fallback).
4. Order candidates by `upstreamRoutingStrategy`:
   - `priority` (default): ascending priority → descending weight → name.
   - `weighted-random`: weighted shuffle.
5. For each candidate, call `pickEndpointCredential(endpointId, upstreamId)` from an in-memory credential pool.
6. Credential pool is cached as `"endpointId:upstreamId"` (or `"endpointId:official"` for null upstream).
7. Credential selection uses `loadBalanceStrategy`: `round-robin` (SWRR, Nginx-style) or `random` (weighted).
8. Health-aware: credentials with consecutive failures get exponential penalty (30s base, doubles, max 2min).

In practice that means:

- Non-legacy upstream credential pools are `(endpointId, upstreamId)`.
- Official/default credential pools are `(endpointId, null)` stored under cache key `"endpointId:official"`.
- Under `priority` strategy, the legacy target is always tried last (`priority=1000`), which means official credentials act as a fallback, not the primary path.

This is why the current UI has a credential-level upstream selector with an `official` option.

### Admin UI Split

The UI is currently split across three pages:

- `ai-endpoints`: master-detail page. Detail view shows endpoint info + upstream assignment table (priority, weight, enabled per assignment). Assignment CRUD lives here.
- `ai-credentials`: groups credentials by `endpointId` into `EndpointPoolCard` components. Each card is a flat list of credentials; each credential row has an inline upstream `Select` dropdown with `"official"` as default plus the endpoint's enabled assignments. No grouping by upstream within an endpoint.
- `ai-upstreams`: master-detail page. List view shows health/metric cards. Detail view shows reverse assignment list (which endpoints use this upstream) + recent requests. Does not list individual credentials.

That split is functional, but not very natural for day-to-day operations. In particular, to understand "which credentials serve a specific upstream for a specific endpoint", the admin must mentally cross-reference the credentials page with the endpoint's assignment table.

## What Already Exists

The backend already supports most of the semantics needed for upstream-centric credential management:

- A credential assignment can already be bound to a specific upstream.
- Assignment validation already exists on credential create/update.
- Deleting an assignment already nulls credentials back to endpoint default.
- Credential pool invalidation already understands `(endpointId, upstreamId)` scope.
- Usage logs already capture `upstreamId`, `upstreamName`, and `upstreamBaseUrl`.

This is enough to support a better management UX without changing the database.

## What Does Not Exist Yet

Three things are still legacy-shaped:

### 1. Official upstream is not a real upstream row

The "official" path is still represented as:

- `endpoint.baseUrl`
- `ai_endpoint_credentials.upstreamId = null`
- a virtual runtime target named `official`

So "official upstream" is not actually stored in `ai_upstreams`.

### 2. Upstreams do not truly own credentials at global scope

A credential assignment still fundamentally belongs to an endpoint, because the endpoint owns:

- auth type
- auth config
- API format
- model catalog
- credential load-balancing strategy

An upstream alone is not enough to relay a request.

That means a global upstream page cannot safely become the single source of truth for credential CRUD unless endpoint context is still present.

### 3. Global upstream sharing complicates a pure upstream-owned UI

`ai_upstreams` is global and may be assigned to multiple endpoints.

So if a credential is shown "under an upstream", the UI still needs to answer:

- under which endpoint?

This is another reason why endpoint-scoped upstream management is the safer first step.

## Recommendation

The recommended path is to ship an endpoint-scoped UX first, and only normalize the official upstream into a real entity if the product later needs that stronger guarantee.

### Phase 1: Endpoint-Scoped Upstream-Owned Credential Management

#### Product shape

Keep endpoint as the top-level domain object, but make upstream the primary grouping inside endpoint management.

New mental model:

```text
Endpoint
  ├─ Official upstream (virtual)
  │    ├─ credential A
  │    ├─ credential B
  │    └─ credential C
  ├─ OpenRouter upstream
  │    ├─ credential D
  │    ├─ credential E
  │    ├─ credential F
  │    └─ credential G
  └─ Custom upstream
       ├─ credential H
       └─ credential I
```

In this phase:

- "official upstream" remains virtual
- `upstreamId = null` still means official/default
- routing and persistence do not change

#### Why this fits the current architecture

This matches the current backend exactly:

- endpoint-scoped credential pools already exist
- endpoint-scoped upstream assignments already exist
- official/default is already an endpoint-scoped null-upstream pool

So the backend model does not need to change to support this UX.

#### UI proposal

Replace the current separation of:

- endpoint upstream assignment table
- global credential page with per-credential upstream selector

with an endpoint detail page that renders upstream buckets.

Each bucket should show:

- upstream name
- routing controls
- enabled state
- credential count
- credentials bound to this upstream
- add credential button
- move credential action

Recommended bucket types:

1. Official bucket
   - virtual row derived from `endpoint.baseUrl`
   - contains credentials where `upstreamId = null`

2. Assigned upstream buckets
   - one bucket per `ai_upstream_assignment`
   - contains credentials where `credential.upstreamId = assignment.upstream.id`

#### API approach

There are two viable implementation options.

##### Option A: frontend-only composition (current baseline)

Reuse existing APIs:

- `GET /api/admin/ai/endpoints`
- `GET /api/admin/ai/endpoints/:id/upstreams`
- `GET /api/admin/ai/endpoint-credentials`

The client filters credentials by `endpointId` and groups them by `upstreamId ?? "official"`.

**Note**: The current `ai-credentials` page already does this grouping by `endpointId` and provides a per-credential upstream selector. Phase 1 Option A is not new API work — it is a frontend re-grouping of data that is already fetched. The change is: replace the flat credential list with per-credential upstream dropdown → upstream bucket sections each containing their credentials.

##### Option B: add an endpoint upstream-pools endpoint

Add a dedicated endpoint-scoped endpoint, for example:

`GET /api/admin/ai/endpoints/:id/upstream-pools`

Response shape:

- endpoint info
- one virtual official bucket
- assigned upstream buckets
- credential counts and credential lists per bucket

This is cleaner for the client and avoids repeated client-side grouping logic.

The backend work is still small because it is only aggregation over data that already exists.

#### Changes Needed

##### Frontend

Medium.

- Rework endpoint detail page to render upstream buckets instead of only an assignment table.
- Let "Add credential" originate from a bucket so `endpointId` and `upstreamId` are pre-filled.
- Replace inline "assign upstream to credential" with "move credential to another bucket".
- Optionally demote the standalone `ai-credentials` page into an inventory/debug page.

Open interaction design decisions (not yet specified):

- **Move credential**: dropdown selector per credential, or a dialog with bucket target? Drag-and-drop is not recommended given the existing shadcn/Radix stack.
- **Empty buckets**: should upstream buckets with 0 credentials still be visible? Recommended yes — shows the upstream is assigned but has no credentials, which is useful operational signal.
- **Add credential from bucket**: should open a dialog with `endpointId` and `upstreamId` pre-filled. The current `AddCredentialDialog` already accepts these as form fields — the change is auto-populating them.
- **Credential sort within bucket**: recommend `weight desc → lastUsedAt desc → name asc` to match the runtime selection order.
- **Owner display**: `key_providers` (revenue-share partners) should remain visible per credential row inside buckets, not be hidden by the bucket reorganization.

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

- every credential belongs to an upstream
- official is just another upstream
- `upstreamId = null` is no longer a meaningful runtime state

#### Proposed model

For each endpoint, create one explicit official upstream row and one assignment:

```text
Endpoint "openai"
  ├─ Official upstream row: kind=official, baseUrl=endpoint.baseUrl
  ├─ OpenRouter upstream row
  └─ Custom upstream row
```

Important note:

- official upstreams should still be endpoint-specific rows
- they should not be globally shared by default

Even though upstreams are globally modeled, the official upstream for one endpoint is not semantically interchangeable with another endpoint because auth and model semantics remain endpoint-owned.

#### Required changes

##### Data migration

- Create one official upstream row per endpoint.
- Create one endpoint → upstream assignment for each official row.
- Backfill `ai_endpoint_credentials.upstreamId = officialUpstreamId` for rows currently using `NULL`.
- No new FKs. The new official upstream rows and assignments are linked by application logic only. Deletion cascades, orphan cleanup, and integrity checks must be enforced in repos and route handlers.

##### Runtime

- Stop auto-appending the legacy runtime target from `endpoint.baseUrl`.
- Resolve only explicit assignments.
- Decide whether `endpoint.baseUrl` remains:
  - as a compatibility copy of the official upstream URL
  - or as a deprecated field written from official upstream state

**Cache migration risk**: The credential-balancer caches pools under `"endpointId:upstreamId"` and `"endpointId:official"`. After migration:

- All `"endpointId:official"` cache entries become stale and must be invalidated.
- New entries will use `"endpointId:officialUpstreamId"`.
- During a rolling deploy, old instances may still write `"endpointId:official"` keys while new instances write `"endpointId:officialUpstreamId"`, causing duplicate pools. Mitigation: invalidate all credential pool caches as part of the migration, and ensure the cache TTL (currently 30s for upstream candidates) is shorter than the deploy window.

##### API

- Credential creation should default to the endpoint's official upstream ID, not `null`.
- Assignment deletion rules need a special case for official upstream:
  - probably do not allow deleting the endpoint's official assignment
  - or require replacing it first
- All referential integrity enforced in application code — no FK constraints on new or modified columns. Orphan prevention, cascade deletes, and nullification are repo/handler responsibilities.

##### Seeding / bootstrap

- endpoint creation or endpoint seed must also create the official upstream assignment automatically

##### Observability

- upstream overview will now include official upstreams as real rows
- credentials currently hidden under `null upstream` will become visible in upstream-level stats

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

- global upstream page must manage official credentials directly
- upstream analytics must include official traffic as first-class rows
- the product wants to eliminate `null upstream` semantics completely

## Concrete Scope Assessment

If the requested change is interpreted as:

- "inside an endpoint, manage credentials under official / OpenRouter / custom upstream buckets"

then the answer is:

- yes, mostly UI
- backend is largely already there

If the requested change is interpreted as:

- "official upstream should become a real upstream entity everywhere in the system"

then the answer is:

- no, not just UI
- backend and runtime still have legacy endpoint-default behavior to remove

## Implementation Notes

### Recommended first release

For the first release:

- keep `ai_endpoint_credentials.upstreamId = null` as official/default
- add endpoint-scoped upstream buckets in the endpoint detail page
- keep the existing global upstream health page
- keep current credential CRUD routes
- optionally add one aggregate endpoint if the client becomes too awkward

### Suggested page ownership

- `ai-endpoints` becomes the main operational page
- `ai-upstreams` remains inventory / health / diagnostics
- `ai-credentials` becomes secondary, or can later be removed from primary navigation

This matches the current domain better than trying to make the global upstream page own credentials.

## Open Questions

1. Do we actually use the same global upstream row across multiple endpoints in production?
   - **Architecture note**: The schema allows it (`ai_upstream_assignments` has a unique constraint on `(endpoint_id, upstream_id)`, not a unique on `upstream_id`). This is by design for shared resellers like OpenRouter that serve multiple endpoint formats. Verify actual usage with production data.

2. Do we want the `ai-credentials` page to remain as an advanced inventory page?
   - **Recommendation**: Yes, keep as an inventory/debug view. It currently provides a cross-endpoint flat list that is useful for searching by key prefix, finding orphaned credentials, and bulk operations. The endpoint-scoped bucket view cannot replace this use case.

3. If we later normalize official upstreams, should endpoint deletion also clean up the official upstream row, or should official upstreams be protected?
   - **Consideration**: Since no new FKs are allowed, endpoint deletion must handle cleanup in application code: delete the endpoint's credentials, delete assignments, and optionally delete the official upstream row. The repo/handler must enforce the correct order. A `kind=official` marker on the upstream row can help the application identify which upstreams are endpoint-specific and safe to delete vs shared and must be preserved.

4. **New**: Under `priority` routing strategy, the legacy target has `priority=1000` (always last). Should the Phase 1 "Official" bucket UI surface this priority information to help admins understand that official credentials are a fallback, not the primary path?

5. **New**: How should `key_providers` (owner/revenue-share partner) information be displayed in the bucket view? Current credential rows show owner name as a badge. This should carry over into the bucket layout.

## Conclusion

The current backend is already strong enough for the UX change the product wants, as long as we keep the change endpoint-scoped.

So the best path is:

- Phase 1 now: UI reorganization around endpoint-scoped upstream buckets
- Phase 2 later: optional removal of legacy official/default behavior

That gives the natural "upstream owns credentials" experience without forcing a risky runtime migration.
