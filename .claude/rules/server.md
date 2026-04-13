# Server Rules

## Identifier Boundaries

External identifiers are input/output concerns. Internal identifiers drive business logic.

- Accept `uuid`/public IDs at route boundaries when the UI or external callers use them.
- Resolve them to internal numeric `id` as early as possible.
- Keep downstream repos, auth, billing, and transactional flows keyed by internal `id` unless a route is explicitly designed around a public identifier.

When adding a new external lookup path:

- parse and validate the public identifier at the route boundary
- resolve it to internal `id`
- reuse the existing internal code path
- fail closed when the public identifier does not resolve

❌ Threading `uuid` deep into internal service logic without need.
❌ Duplicating business logic for `uuid` and `id` paths when simple resolution would reuse the existing path.
❌ Falling back to an unfiltered query when a provided public identifier is invalid or not found.

## Logging

All logging via `log` from `@/server/lib/logger`. Use child loggers (`log.gateway`, `log.redis`, etc.). Errors as `{ err }` in first arg. Exception: `printBanner()` and standalone scripts.

❌ `console.log/warn/error` in `src/server/` or `src/blockchain/`.

## Error Responses

Always `c.json({ error: "message" }, statusCode)`.

## Hot Path

Non-critical DB writes use `enqueueWrite()` — never block response.
After resource CRUD: always `invalidateResource()` + `invalidateRouteConfig()`.

## SSE

Real-time updates via `subscribeToEvents`. `null` merchantId = admin/all events.
