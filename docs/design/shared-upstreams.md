# Design: Shared Upstreams (M:N Endpoint ↔ Upstream)

## Problem

Currently each upstream belongs to exactly one endpoint (1:N). If the same upstream is used by multiple endpoints, the admin must create duplicate upstream rows under each endpoint with the same base URL and metadata.

That causes three problems:

- Duplicate config drifts over time.
- The admin UI mixes two concepts into one row: "upstream entity" and "endpoint-specific routing config".
- Routing, credential binding, and observability all assume "upstream belongs to one endpoint", which blocks a shared pool design.

## Goal

Make upstreams first-class global entities that can be attached to multiple endpoints.

- An upstream is created once in a global pool.
- An endpoint attaches that upstream through an assignment row.
- Routing config such as `priority`, `weight`, and `enabled` lives on the assignment.
- A credential may still target a specific upstream, but only within the context of its owning endpoint.

## Non-Goals

- Do not change endpoint-level routing strategy semantics (`priority` vs `weighted-random`).
- Do not change credential load-balancing strategy semantics (`round-robin` vs `random`).
- Do not attempt to share credentials across endpoints.
- Do not silently merge ambiguous legacy upstream rows during migration.

## Current Architecture

```text
aiSupplierConnections (1) ──FK──→ (N) aiEndpointUpstreams
                              ↑
                         aiEndpointCredentials.upstreamId (nullable FK, SET NULL)
```

- `aiEndpointUpstreams.endpointId` is non-null and cascades on endpoint delete.
- `aiEndpointUpstreams` is unique on `(endpointId, upstreamId)`.
- Gateway routing resolves candidates by `endpointId`.
- Upstream candidate cache is keyed by `endpoint.id`.
- Credential balancer pools are keyed by `"endpointId:upstreamId"`.
- Admin CRUD is nested under `/endpoints/:id/upstreams`.
- Usage/health pages currently treat one row as "endpoint-upstream", not "global upstream".

## Proposed Architecture

### Data Model

```text
aiSupplierConnections (M) ←── aiUpstreamAssignments ──→ (N) aiUpstreams
                          (junction table)              ↑
                                                  aiEndpointCredentials.upstreamId
```

### `aiUpstreams`

Rename the concept of `aiEndpointUpstreams` into a global upstream entity:

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

- `endpointId`
- `priority`
- `weight`

### `aiUpstreamAssignments`

New junction table for endpoint-specific attachment and routing:

| Column       | Type                                                     | Notes                    |
| ------------ | -------------------------------------------------------- | ------------------------ |
| `id`         | serial PK                                                | Assignment ID            |
| `endpointId` | integer NOT NULL FK → `aiSupplierConnections.id` CASCADE |                          |
| `upstreamId` | integer NOT NULL FK → `aiUpstreams.id` CASCADE           |                          |
| `priority`   | integer NOT NULL default 100                             | Endpoint-scoped priority |
| `weight`     | integer NOT NULL default 1                               | Endpoint-scoped weight   |
| `enabled`    | boolean NOT NULL default true                            | Assignment-level switch  |
| `createdAt`  | timestamp                                                |                          |
| `updatedAt`  | timestamp                                                |                          |

Constraints and indexes:

- `UNIQUE(endpointId, upstreamId)`
- index on `endpointId`
- index on `upstreamId`

### `aiEndpointCredentials`

`aiEndpointCredentials.upstreamId` continues to point to `aiUpstreams.id`.

Important semantic rule:

- A credential belongs to exactly one endpoint via `aiEndpointCredentials.endpointId`.
- If `aiEndpointCredentials.upstreamId` is non-null, there must be an active assignment between `aiEndpointCredentials.endpointId` and that upstream.

This rule is enforced in service code and on destructive assignment operations:

- credential create/update must validate that the endpoint has that assignment
- assignment delete must either fail when bound credentials exist, or null those credentials in the same transaction

Recommended v1 behavior:

- assignment delete is allowed
- all credentials owned by that endpoint and bound to that upstream are set to `NULL`
- API returns `affectedCredentials` so the UI can warn precisely

This keeps the credential model simple and avoids introducing `assignmentId` into `aiEndpointCredentials` unless later needed.

### Legacy Mapping Table

Add a temporary migration-only table:

`aiUpstreamLegacyMap(oldUpstreamId, endpointId, newUpstreamId, migrationGroupKey)`

Purpose:

- remap `ai_endpoint_credentials.upstream_id`
- remap `ai_usage_logs.upstream_id`
- allow shadow reads during rollout
- enable rollback/verification before the old table is dropped

## Identity and Migration Rules

### Canonical identity

The new global upstream slug `aiUpstreams.upstreamId` is globally unique.

Legacy data does not guarantee that today. Current uniqueness is only scoped by endpoint.

### Preflight audit is mandatory

Before data migration, run a preflight audit over legacy `ai_endpoint_upstreams` grouped by `upstream_id`.

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

`resolveUpstreamCandidates(endpoint)` changes from querying upstream rows directly to querying assignments joined with upstream entities.

```ts
// Before
const upstreams = await upstreamRepo.findEnabledByEndpointId(endpoint.id);

// After
const assignments = await assignmentRepo.findEnabledByEndpointId(endpoint.id);
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

- endpoint-level `upstreamRoutingStrategy` still decides sort vs weighted shuffle
- legacy `endpoint.baseUrl` fallback is still appended as a candidate when present

## Cache and Pool Invalidation

### Upstream candidate cache

Current cache is keyed by `endpoint.id`. Keep that keying.

Invalidation rules:

- assignment create/update/delete: invalidate only that endpoint
- endpoint update affecting `baseUrl` or routing strategy: invalidate that endpoint
- upstream global update/delete: invalidate all endpoints assigned to that upstream

### Credential pool cache

Current credential pool cache is keyed by `"endpointId:upstreamId"`. Keep that shape.

Additional invalidation rules are needed:

- when an assignment is removed and credentials are nulled, invalidate:
  - `endpointId:<upstreamId>`
  - `endpointId:official` if credentials fall back to endpoint default
- when a global upstream is disabled, invalidate all endpoint pools bound to that upstream

## Observability Semantics

This part must change explicitly. The current overview page is built around endpoint-owned upstream rows, and that assumption no longer holds.

### Usage log storage

Keep writing these denormalized snapshots in `ai_usage_logs`:

- `endpointId`
- `upstreamId`
- `upstreamName`
- `upstreamBaseUrl`

After migration, `upstreamId` means global upstream ID.

### Aggregation rules

Two views are needed:

1. Global upstream view
   - aggregate by `upstreamId`
   - used by `/api/admin/ai/upstreams` and `/api/admin/ai/upstreams/:id`
   - shows total requests, total credentials, assignment count, recent health

2. Endpoint assignment view
   - aggregate by `(endpointId, upstreamId)`
   - used by endpoint detail pages
   - shows assignment-specific health and traffic

Do not reuse an endpoint-scoped overview response shape for the global upstream page.

### Recent traffic

Keep `GET /api/admin/ai/upstreams/:id/recent`, but define it as:

- global upstream recent traffic across all endpoints by default
- optional `endpointId` query parameter for endpoint-specific drill-down

## API Design

### Global upstream endpoints

| Method   | Path                                 | Purpose                                                                |
| -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `GET`    | `/api/admin/ai/upstreams`            | List global upstreams with assignment counts and summary stats         |
| `POST`   | `/api/admin/ai/upstreams`            | Create a global upstream                                               |
| `GET`    | `/api/admin/ai/upstreams/:id`        | Get detail: upstream, assignments, credential counts, recent summary   |
| `PUT`    | `/api/admin/ai/upstreams/:id`        | Update global fields: `name`, `baseUrl`, `kind`, `metadata`, `enabled` |
| `DELETE` | `/api/admin/ai/upstreams/:id`        | Delete upstream, remove assignments, null bound credentials            |
| `GET`    | `/api/admin/ai/upstreams/:id/recent` | Recent usage rows, optional `endpointId` filter                        |
| `GET`    | `/api/admin/ai/upstreams/overview`   | Global health overview for dashboard cards/table                       |

### Endpoint assignment endpoints

| Method   | Path                                                  | Purpose                                                   |
| -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/api/admin/ai/endpoints/:id/upstreams`               | List assignments joined with upstream details             |
| `POST`   | `/api/admin/ai/endpoints/:id/upstreams`               | Assign an existing global upstream                        |
| `PUT`    | `/api/admin/ai/endpoints/:id/upstreams/:assignmentId` | Update assignment fields: `priority`, `weight`, `enabled` |
| `DELETE` | `/api/admin/ai/endpoints/:id/upstreams/:assignmentId` | Remove assignment and null bound credentials              |

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
type EndpointUpstreamAssignment = {
  id: number; // assignment id
  endpointId: number;
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
  credentialCount: number;
  enabledCredentialCount: number;
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
- enabled credential count
- recent request volume
- health status

Detail view for one upstream:

- upstream info
- global edit/delete/toggle
- assignments list
- credentials summary
- recent traffic

Important UI distinction:

- global `enabled` belongs to the upstream entity
- assignment `enabled` belongs to one endpoint attachment

### `ai-endpoints` detail page

Replace "create endpoint-owned upstream" with "assign global upstream".

Endpoint upstream section:

- `Assign Upstream` button opens global upstream picker
- rows render assignments, not global upstream entities
- per-row edit controls only affect `priority`, `weight`, `enabled`
- removing a row detaches the assignment and warns about affected credentials

### `ai-credentials` UI

The credential create/edit UI must continue to filter selectable upstreams by endpoint.

Behavior:

- load endpoint assignments, not all global upstreams
- show only assigned upstreams in the dropdown
- if an assignment is removed, credentials bound to it fall back to official/base URL and the UI should surface that state after refetch

## Migration Strategy

### Phase 0 — Audit and preparation

1. Build and run a preflight script over existing `ai_endpoint_upstreams`.
2. Emit:
   - duplicate slug groups
   - conflicting rows by slug
   - proposed merge groups
   - credential counts and usage-log counts per legacy upstream ID
3. Resolve all conflicts before any schema backfill runs.

Exit criteria:

- every legacy row belongs to one explicit migration group
- every migration group maps to one target global slug

### Phase 1 — Additive schema migration

1. Create `ai_upstreams`.
2. Create `ai_upstream_assignments`.
3. Create `ai_upstream_legacy_map`.
4. Keep old `ai_endpoint_upstreams` and old APIs intact.

No reads switch yet.

### Phase 2 — Data backfill

1. Insert one `ai_upstreams` row per resolved migration group.
2. Insert one assignment row per legacy endpoint-upstream row.
3. Write `ai_upstream_legacy_map` for every old row.
4. Remap `ai_endpoint_credentials.upstream_id` from old IDs to new global IDs.
5. Remap `ai_usage_logs.upstream_id` from old IDs to new global IDs.
6. Verify counts:
   - upstream row counts by migration group
   - assignment counts
   - credential counts per upstream
   - usage-log counts per upstream before/after remap

This phase should run in idempotent chunks or a transactionally safe migration script, depending on dataset size.

### Phase 3 — Dual-read / compatibility layer

1. Add new repositories for global upstreams and assignments.
2. Add new top-level upstream routes.
3. Change endpoint nested routes to operate on assignments.
4. Keep response compatibility where practical for a short transition window.
5. Add shadow checks comparing:
   - old endpoint upstream reads vs new assignment reads
   - old routing candidates vs new routing candidates

### Phase 4 — Switch runtime reads

1. Switch `resolveUpstreamCandidates()` to assignments + global upstreams.
2. Switch credential validation to assignments.
3. Switch admin pages and hooks to new schemas/query keys.
4. Switch overview pages to the new aggregation model.

### Phase 5 — Cleanup

Only after verification passes:

1. remove old repositories and legacy route code
2. drop old `ai_endpoint_upstreams`
3. drop `ai_upstream_legacy_map`
4. remove shadow checks and compatibility shims

## Testing Plan

### Migration tests

- duplicate slug, identical fields -> merges successfully
- duplicate slug, conflicting fields -> migration aborts with report
- credentials remap to new upstream IDs correctly
- usage logs remap without row loss

### API tests

- create upstream
- assign upstream to endpoint
- prevent duplicate assignment
- credential create/update rejects unassigned upstream
- assignment delete nulls bound credentials and returns affected count
- global upstream disable invalidates all assigned endpoint caches

### Routing tests

- endpoint with one assignment resolves that upstream plus official fallback
- endpoint with multiple assignments preserves `priority` and `weight`
- disabled global upstream is excluded
- disabled assignment is excluded

### UI tests

- endpoint page assigns existing upstream instead of creating one
- credential dialog only shows endpoint-assigned upstreams
- global upstream detail shows assignments and recent traffic
- assignment removal updates credential dropdown state after refetch

## Risks and Mitigations

| Risk                                                                    | Mitigation                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Legacy slug conflicts make migration ambiguous                          | Mandatory preflight audit and operator resolution                                    |
| Credentials end up pointing to upstreams not assigned to their endpoint | Validate on credential write path and null credentials during assignment delete      |
| Global upstream updates fan out cache invalidation to many endpoints    | Upstream writes are rare; invalidate assigned endpoints only                         |
| Overview pages mix global and endpoint-scoped traffic incorrectly       | Define separate aggregation shapes for global upstream and endpoint assignment views |
| Historical logs become disconnected from new upstream IDs               | Use legacy mapping table and explicit remap verification                             |
| Rollout breaks routing behavior                                         | Dual-read shadow validation before switching runtime reads                           |

## Recommended Implementation Order

1. Preflight audit script
2. New schema and repos
3. Backfill and remap scripts
4. Routing + cache invalidation
5. Admin APIs
6. `ai-credentials` UI adaptation
7. `ai-endpoints` assignment UI
8. `ai-upstreams` global management UI
9. Cleanup
