# Upstream Concurrency Control

## Background

Some upstreams, such as GLM-compatible endpoints, have limited concurrent request capacity. Prismix should avoid sending bursts above an upstream's configured capacity while keeping the existing synchronous JSON and SSE relay behavior.

## Goal

Protect a configured upstream by limiting in-flight relay requests per numeric `ai_upstreams.id`. Requests that arrive above the configured limit wait briefly for a slot and then either proceed, try the next candidate, or return an upstream-exhausted error.

## Scope

- Scope key: `upstreamId` (`ai_upstreams.id`).
- Legacy provider default URLs (`upstreamId = null`) are not limited. Configure GLM as a real upstream row to enable protection.
- The request remains in the API process. The existing BullMQ write queue is not used for relay execution because it cannot return streaming responses to the current HTTP request.
- Consumer and admin relay paths both honor the same limit.

## Implementation Tasks

1. Add upstream config fields:
   - `concurrencyLimit`: nullable positive integer; null means unlimited.
   - `queueTimeoutMs`: positive integer; defaults to 30 seconds.
2. Implement Redis-backed admission queue:
   - `active` sorted set stores leases with expiration.
   - `waiting` sorted set stores queued request tokens by enqueue time.
   - acquire is atomic through Lua and preserves first-waiter priority when a slot opens.
   - release removes the token from both active and waiting sets.
3. Integrate relay request paths:
   - cache hits do not acquire a slot.
   - non-streaming requests release in a `finally` block.
   - streaming requests release from stream finalization after completion, timeout, or client abort.
   - local queue timeout is not treated as key/upstream failure.
4. Expose configuration in admin upstream forms and detail views.
5. Add tests for immediate acquire, waiting acquire, timeout cleanup, and relay regression coverage.

## Acceptance Criteria

- When `concurrencyLimit` is unset, behavior is unchanged.
- When the active count for an upstream is below the limit, the request proceeds immediately.
- When active count reaches the limit, later requests wait up to `queueTimeoutMs`.
- A released slot lets a waiting request proceed without sending extra concurrent upstream fetches.
- Stream completion, stream timeout, upstream fetch error, non-stream response, and early returns release the lease.
- Queue timeout causes fallback to another candidate when available, without calling `markKeyFailure`.
- Admin UI can set and inspect the limit.

## Notes

This is intentionally not a durable job system. It is a lightweight backpressure layer whose purpose is to smooth request pressure on upstreams without changing client-facing relay protocols.
