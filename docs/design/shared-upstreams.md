# Design: Shared Upstreams (M:N Provider ↔ Upstream)

## Problem

Currently each upstream belongs to exactly one provider (1:N). If the same endpoint is used by multiple providers, the admin must create duplicate upstream rows under each provider with the same base URL and metadata.

That causes three problems:

- Duplicate config drifts over time.
- The admin UI mixes two concepts into one row: "upstream entity" and "provider-specific routing config".
- Routing, key binding, and observability all assume "upstream belongs to one provider", which blocks a shared pool design.

## Goal

Make upstreams first-class global entities that can be attached to multiple providers.

- An upstream is created once in a global pool.
- A provider attaches that upstream through an assignment row.
- Routing config such as `priority`, `weight`, and `enabled` lives on the assignment.
- A key may still target a specific upstream, but only within the context of its owning provider.

## Non-Goals

- Do not change provider-level routing strategy semantics (`priority` vs `weighted-random`).
- Do not change key load-balancing strategy semantics (`round-robin` vs `random`).
- Do not attempt to share keys across providers.
- Do not silently merge ambiguous legacy upstream rows during migration.

## Current Architecture

```text
aiProviders (1) ──FK──→ (N) aiProviderUpstreams
                              ↑
                         aiKeys.upstreamId (nullable FK, SET NULL)
```

- `aiProviderUpstreams.providerId` is non-null and cascades on provider delete.
- `aiProviderUpstreams` is unique on `(providerId, upstreamId)`.
- Gateway routing resolves candidates by `providerId`.
- Upstream candidate cache is keyed by `provider.id`.
- Key balancer pools are keyed by `"providerId:upstreamId"`.
- Admin CRUD is nested under `/providers/:id/upstreams`.
- Usage/health pages currently treat one row as "provider-upstream", not "global upstream".

## Proposed Architecture

### Data Model

```text
aiProviders (M) ←── aiProviderUpstreamAssignments ──→ (N) aiUpstreams
                         (junction table)                     ↑
                                                        aiKeys.upstreamId
```

### `aiUpstreams`

Rename the concept of `aiProviderUpstreams` into a global upstream entity:

| Column       | Type                           | Notes                                             |
| ------------ | ------------------------------ | ------------------------------------------------- |
| `id`         | serial PK                      | New canonical upstream ID                         |
| `upstreamId` | text NOT NULL UNIQUE           | Global unique slug, e.g. `openrouter-main`        |
| `name`       | text NOT NULL                  | Display name                                      |
| `baseUrl`    | text NOT NULL                  | Shared target base URL                            |
| `kind`       | text NOT NULL default `custom` | `official` / `reseller` / `openrouter` / `custom` |
| `metadata`   | text NOT NULL default `{}`     | JSON blob                                         |
| `enabled`    | boolean NOT NULL default true  | Global hard switch                                |
| `updatedAt`  | timestamp                      |                                                   |
| `createdAt`  | timestamp                      |                                                   |

Removed from upstream:

- `providerId`
- `priority`
- `weight`

### `aiProviderUpstreamAssignments`

New junction table for provider-specific attachment and routing:

| Column       | Type                                           | Notes                    |
| ------------ | ---------------------------------------------- | ------------------------ |
| `id`         | serial PK                                      | Assignment ID            |
| `providerId` | integer NOT NULL FK → `aiProviders.id` CASCADE |                          |
| `upstreamId` | integer NOT NULL FK → `aiUpstreams.id` CASCADE |                          |
| `priority`   | integer NOT NULL default 100                   | Provider-scoped priority |
| `weight`     | integer NOT NULL default 1                     | Provider-scoped weight   |
| `enabled`    | boolean NOT NULL default true                  | Assignment-level switch  |
| `createdAt`  | timestamp                                      |                          |
| `updatedAt`  | timestamp                                      |                          |

Constraints and indexes:

- `UNIQUE(providerId, upstreamId)`
- index on `providerId`
- index on `upstreamId`

### `aiKeys`

`aiKeys.upstreamId` continues to point to `aiUpstreams.id`.

Important semantic rule:

- A key belongs to exactly one provider via `aiKeys.providerId`.
- If `aiKeys.upstreamId` is non-null, there must be an active assignment between `aiKeys.providerId` and that upstream.

This rule is enforced in service code and on destructive assignment operations:

- key create/update must validate that the provider has that assignment
- assignment delete must either fail when bound keys exist, or null those keys in the same transaction

Recommended v1 behavior:

- assignment delete is allowed
- all keys owned by that provider and bound to that upstream are set to `NULL`
- API returns `affectedKeys` so the UI can warn precisely

This keeps the key model simple and avoids introducing `assignmentId` into `aiKeys` unless later needed.

### Legacy Mapping Table

Add a temporary migration-only table:

`aiUpstreamLegacyMap(oldUpstreamId, providerId, newUpstreamId, migrationGroupKey)`

Purpose:

- remap `ai_keys.upstream_id`
- remap `ai_usage_logs.upstream_id`
- allow shadow reads during rollout
- enable rollback/verification before the old table is dropped

## Identity and Migration Rules

### Canonical identity

The new global upstream slug `aiUpstreams.upstreamId` is globally unique.

Legacy data does not guarantee that today. Current uniqueness is only scoped by provider.

### Preflight audit is mandatory

Before data migration, run a preflight audit over legacy `ai_provider_upstreams` grouped by `upstream_id`.

For each slug group:

1. If all rows have equivalent `baseUrl`, `kind`, and normalized `metadata`, they may merge into one global upstream.
2. If rows share the same slug but differ in those fields, migration must stop and emit a conflict report.
3. Conflicts are resolved explicitly before migration by one of:
   - manual rename of one slug
   - manual normalization of mismatched fields
   - explicit operator-approved merge rule

Do not silently auto-rename or auto-merge conflicting rows.

This makes the migration slower but safe and reproducible.

## Routing Changes

`resolveUpstreamCandidates(provider)` changes from querying upstream rows directly to querying assignments joined with upstream entities.

```ts
// Before
const upstreams = await upstreamRepo.findEnabledByProviderId(provider.id);

// After
const assignments = await assignmentRepo.findEnabledByProviderId(provider.id);
// join aiUpstreams
// filter assignment.enabled = true AND upstream.enabled = true
```

`UpstreamTarget` should continue to expose the routing fields the relay already needs:

- `id` = global upstream ID
- `upstreamId` = global slug
- `name`
- `baseUrl`
- `kind`
- `priority`
- `weight`
- `isLegacy`

The routing algorithm remains unchanged:

- provider-level `upstreamRoutingStrategy` still decides sort vs weighted shuffle
- legacy `provider.baseUrl` fallback is still appended as a candidate when present

## Cache and Pool Invalidation

### Upstream candidate cache

Current cache is keyed by `provider.id`. Keep that keying.

Invalidation rules:

- assignment create/update/delete: invalidate only that provider
- provider update affecting `baseUrl` or routing strategy: invalidate that provider
- upstream global update/delete: invalidate all providers assigned to that upstream

### Key pool cache

Current key pool cache is keyed by `"providerId:upstreamId"`. Keep that shape.

Additional invalidation rules are needed:

- when an assignment is removed and keys are nulled, invalidate:
  - `providerId:<upstreamId>`
  - `providerId:legacy` if keys fall back to provider default
- when a global upstream is disabled, invalidate all provider pools bound to that upstream

## Observability Semantics

This part must change explicitly. The current overview page is built around provider-owned upstream rows, and that assumption no longer holds.

### Usage log storage

Keep writing these denormalized snapshots in `ai_usage_logs`:

- `providerId`
- `upstreamId`
- `upstreamName`
- `upstreamBaseUrl`

After migration, `upstreamId` means global upstream ID.

### Aggregation rules

Two views are needed:

1. Global upstream view
   - aggregate by `upstreamId`
   - used by `/api/admin/ai/upstreams` and `/api/admin/ai/upstreams/:id`
   - shows total requests, total keys, assignment count, recent health

2. Provider assignment view
   - aggregate by `(providerId, upstreamId)`
   - used by provider detail pages
   - shows assignment-specific health and traffic

Do not reuse a provider-scoped overview response shape for the global upstream page.

### Recent traffic

Keep `GET /api/admin/ai/upstreams/:id/recent`, but define it as:

- global upstream recent traffic across all providers by default
- optional `providerId` query parameter for provider-specific drill-down

## API Design

### Global upstream endpoints

| Method   | Path                                 | Purpose                                                                |
| -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `GET`    | `/api/admin/ai/upstreams`            | List global upstreams with assignment counts and summary stats         |
| `POST`   | `/api/admin/ai/upstreams`            | Create a global upstream                                               |
| `GET`    | `/api/admin/ai/upstreams/:id`        | Get detail: upstream, assignments, key counts, recent summary          |
| `PUT`    | `/api/admin/ai/upstreams/:id`        | Update global fields: `name`, `baseUrl`, `kind`, `metadata`, `enabled` |
| `DELETE` | `/api/admin/ai/upstreams/:id`        | Delete upstream, remove assignments, null bound keys                   |
| `GET`    | `/api/admin/ai/upstreams/:id/recent` | Recent usage rows, optional `providerId` filter                        |
| `GET`    | `/api/admin/ai/upstreams/overview`   | Global health overview for dashboard cards/table                       |

### Provider assignment endpoints

| Method   | Path                                                  | Purpose                                                   |
| -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/api/admin/ai/providers/:id/upstreams`               | List assignments joined with upstream details             |
| `POST`   | `/api/admin/ai/providers/:id/upstreams`               | Assign an existing global upstream                        |
| `PUT`    | `/api/admin/ai/providers/:id/upstreams/:assignmentId` | Update assignment fields: `priority`, `weight`, `enabled` |
| `DELETE` | `/api/admin/ai/providers/:id/upstreams/:assignmentId` | Remove assignment and null bound keys                     |

Suggested POST body:

```json
{
  "upstreamId": 12,
  "priority": 100,
  "weight": 1,
  "enabled": true
}
```

Suggested assignment list shape:

```ts
type ProviderUpstreamAssignment = {
  id: number; // assignment id
  providerId: number;
  upstream: {
    id: number;
    upstreamId: string;
    name: string;
    baseUrl: string;
    kind: string;
    enabled: boolean;
    metadata: Record<string, unknown>;
  };
  priority: number;
  weight: number;
  enabled: boolean;
  keyCount: number;
  enabledKeyCount: number;
  requests24h: number;
  errorRate24h: number;
  createdAt: string;
  updatedAt: string;
};
```

## Frontend Design

### `ai-upstreams` page

This page becomes the global upstream management page.

Grid/list content:

- upstream name
- global slug
- base URL
- kind
- global enabled state
- assignment count
- enabled key count
- recent request volume
- health status

Detail view for one upstream:

- upstream info
- global edit/delete/toggle
- assignments list
- keys summary
- recent traffic

Important UI distinction:

- global `enabled` belongs to the upstream entity
- assignment `enabled` belongs to one provider attachment

### `ai-providers` detail page

Replace "create provider-owned upstream" with "assign global upstream".

Provider upstream section:

- `Assign Upstream` button opens global upstream picker
- rows render assignments, not global upstream entities
- per-row edit controls only affect `priority`, `weight`, `enabled`
- removing a row detaches the assignment and warns about affected keys

### `ai-keys` UI

The key create/edit UI must continue to filter selectable upstreams by provider.

Behavior:

- load provider assignments, not all global upstreams
- show only assigned upstreams in the dropdown
- if an assignment is removed, keys bound to it fall back to legacy/base URL and the UI should surface that state after refetch

## Migration Strategy

### Phase 0 — Audit and preparation

1. Build and run a preflight script over existing `ai_provider_upstreams`.
2. Emit:
   - duplicate slug groups
   - conflicting rows by slug
   - proposed merge groups
   - key counts and usage-log counts per legacy upstream ID
3. Resolve all conflicts before any schema backfill runs.

Exit criteria:

- every legacy row belongs to one explicit migration group
- every migration group maps to one target global slug

### Phase 1 — Additive schema migration

1. Create `ai_upstreams`.
2. Create `ai_provider_upstream_assignments`.
3. Create `ai_upstream_legacy_map`.
4. Keep old `ai_provider_upstreams` and old APIs intact.

No reads switch yet.

### Phase 2 — Data backfill

1. Insert one `ai_upstreams` row per resolved migration group.
2. Insert one assignment row per legacy provider-upstream row.
3. Write `ai_upstream_legacy_map` for every old row.
4. Remap `ai_keys.upstream_id` from old IDs to new global IDs.
5. Remap `ai_usage_logs.upstream_id` from old IDs to new global IDs.
6. Verify counts:
   - upstream row counts by migration group
   - assignment counts
   - key counts per upstream
   - usage-log counts per upstream before/after remap

This phase should run in idempotent chunks or a transactionally safe migration script, depending on dataset size.

### Phase 3 — Dual-read / compatibility layer

1. Add new repositories for global upstreams and assignments.
2. Add new top-level upstream routes.
3. Change provider nested routes to operate on assignments.
4. Keep response compatibility where practical for a short transition window.
5. Add shadow checks comparing:
   - old provider upstream reads vs new assignment reads
   - old routing candidates vs new routing candidates

### Phase 4 — Switch runtime reads

1. Switch `resolveUpstreamCandidates()` to assignments + global upstreams.
2. Switch key validation to assignments.
3. Switch admin pages and hooks to new schemas/query keys.
4. Switch overview pages to the new aggregation model.

### Phase 5 — Cleanup

Only after verification passes:

1. remove old repositories and legacy route code
2. drop old `ai_provider_upstreams`
3. drop `ai_upstream_legacy_map`
4. remove shadow checks and compatibility shims

## Testing Plan

### Migration tests

- duplicate slug, identical fields -> merges successfully
- duplicate slug, conflicting fields -> migration aborts with report
- keys remap to new upstream IDs correctly
- usage logs remap without row loss

### API tests

- create upstream
- assign upstream to provider
- prevent duplicate assignment
- key create/update rejects unassigned upstream
- assignment delete nulls bound keys and returns affected count
- global upstream disable invalidates all assigned provider caches

### Routing tests

- provider with one assignment resolves that upstream plus legacy fallback
- provider with multiple assignments preserves `priority` and `weight`
- disabled global upstream is excluded
- disabled assignment is excluded

### UI tests

- provider page assigns existing upstream instead of creating one
- key dialog only shows provider-assigned upstreams
- global upstream detail shows assignments and recent traffic
- assignment removal updates key dropdown state after refetch

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Legacy slug conflicts make migration ambiguous                       | Mandatory preflight audit and operator resolution                                    |
| Keys end up pointing to upstreams not assigned to their provider     | Validate on key write path and null keys during assignment delete                    |
| Global upstream updates fan out cache invalidation to many providers | Upstream writes are rare; invalidate assigned providers only                         |
| Overview pages mix global and provider-scoped traffic incorrectly    | Define separate aggregation shapes for global upstream and provider assignment views |
| Historical logs become disconnected from new upstream IDs            | Use legacy mapping table and explicit remap verification                             |
| Rollout breaks routing behavior                                      | Dual-read shadow validation before switching runtime reads                           |

## Recommended Implementation Order

1. Preflight audit script
2. New schema and repos
3. Backfill and remap scripts
4. Routing + cache invalidation
5. Admin APIs
6. `ai-keys` UI adaptation
7. `ai-providers` assignment UI
8. `ai-upstreams` global management UI
9. Cleanup
