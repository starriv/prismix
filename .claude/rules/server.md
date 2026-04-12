# Server Rules

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
