# Upstream Provider Rate-Limit Header Capture — Design Plan

## Goal

Capture, normalize, and expose the rate-limit/quota signals returned by upstream LLM providers (OpenAI, Anthropic, Azure OpenAI, Google Gemini, AWS Bedrock) so that Prismix can:

1. **Observe** real provider quota usage (remaining RPM/TPM) per credential — replacing the current blind-retry-on-429 behavior.
2. **Route smarter** — avoid credentials that are near their provider-imposed limit (degrade-and-recover, not just failover).
3. **Back off correctly** — honor provider `Retry-After` semantics instead of immediately retrying the next candidate.

Today, all 12 matches for `Retry-After` / `x-ratelimit-*` in the codebase are OUTBOUND (gateway → client). There is **zero** code reading upstream provider rate-limit headers. On upstream 429, only the status code is inspected (`RETRYABLE_STATUS.has(429)` in `relay.ts:854`, `consumer-relay.ts:1030`) and the credential is marked failed (`markCredentialFailure`) — the response headers are discarded.

## Scope

### In scope

- New module `src/server/ai/lib/upstream-rate-limits.ts` — parser + normalizer.
- Per-adapter parser hooks (dispatch by provider/protocol family).
- Capture point in `stream-proxy.ts` `fetchUpstream()` (line 330) — read headers BEFORE the response body is consumed by the stream pipe.
- Capture point for 429 responses in `relay.ts` / `consumer-relay.ts` retry loops.
- In-memory cache (Redis, TTL = next-reset-window) of latest-known quota per credential.
- Prometheus metrics: `prismix_ai_upstream_rate_limit_remaining_requests` / `_tokens` (gauge, labeled by credentialId + provider).
- New repo method `aiEndpointCredentialRepo.getQuotaSnapshot(credentialId)` for routing decisions.
- Wiring into the existing 3-layer router: when picking the next upstream candidate, prefer credentials with non-zero remaining quota.

### Out of scope (explicitly)

- **Per-consumer TPM enforcement** (separate feature; would need schema column on `relay_consumer_keys`).
- **Azure PTU (Provisioned Throughput)** utilization-based limits — different mechanism, separate design.
- **OpenAI Realtime (WebSocket)** `rate_limits.updated` event — separate transport, separate design.
- **AWS Bedrock** — no rate-limit headers exist; only `ThrottlingException` in body. Bedrock will rely on the existing `markCredentialFailure` + exponential backoff path. No parser needed.
- **Persisting per-request quota snapshots to Postgres** — high write volume, low marginal value over Redis. Redis is the source of truth; Postgres aggregation can be added later if reporting is needed.
- **Frontend UI for per-credential quota** — out of scope; backend + metrics only.

## Provider Coverage Matrix

| Provider      | Read response headers?                         | Read 429 error body?                | Reset format                                                           | `retry-after`?                                |
| ------------- | ---------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| OpenAI        | ✅ All `x-ratelimit-*`                         | Optional                            | Go duration (`1s`, `6m0s`, `17ms`)                                     | ❌ Not documented                             |
| Anthropic     | ✅ All `anthropic-ratelimit-*` + `retry-after` | Optional                            | RFC 3339 timestamp (absolute)                                          | ✅ `retry-after` (sec, 429 only)              |
| Azure OpenAI  | ✅ Same names as OpenAI + `retry-after-ms`     | Optional                            | Plain integer (seconds)                                                | ✅ `retry-after-ms` (ms, 429 only)            |
| Google Gemini | ⚠️ Only `x-gemini-service-tier` (not quota)    | ✅ Required on 429                  | Mixed (`quotaResetDelay` Go duration + `quotaResetTimeStamp` RFC 3339) | ⚠️ No header; `quotaResetDelay` in error body |
| AWS Bedrock   | ❌ None                                        | ✅ Required (`ThrottlingException`) | None (no programmatic field)                                           | ❌ None                                       |

Source: see "Sources" appendix. All header names verified against official docs (not third-party blogs).

## Architecture

### File layout

```
src/server/ai/lib/
  upstream-rate-limits.ts        # New: parser dispatch + normalizer + types
  stream-proxy.ts               # Modified: invoke parser in fetchUpstream() response handling
  upstream-concurrency.ts       # Unchanged (sibling pattern reference)

src/server/ai/protocol-adapters/
  openai.ts                     # Modified: export parseRateLimitHeaders(headers) for OpenAI family
  anthropic.ts                  # Modified: export parseRateLimitHeaders(headers) for Anthropic
  azure-openai.ts               # Modified: export parseRateLimitHeaders(headers) — reuse openai.ts with int-sec parser
  gemini.ts                     # Modified: export parseRateLimitHeaders(headers, errorBody?) for Gemini
  bedrock.ts                    # Unchanged (no headers to parse)
  types.ts                      # Modified: add optional parseRateLimitHeaders to ProtocolAdapter interface

src/server/ai/routes/
  relay.ts                      # Modified: on 429, read retry-after before retrying next candidate
  consumer-relay.ts             # Modified: same

src/server/repos/
  ai-endpoint-credential-repo.ts # New method: updateQuotaSnapshot(credentialId, snapshot)
                                 # New method: getQuotaSnapshot(credentialId) → UpstreamQuotaSnapshot | null

src/server/lib/metrics.ts       # Modified: add 2 Prometheus gauges

src/server/db/schemas/pg.ts     # Unchanged in Phase 1. Phase 2 (optional): add lastKnownQuota JSONB column to ai_endpoint_credentials
```

### Data model

```ts
// src/server/ai/lib/upstream-rate-limits.ts

/**
 * Normalized, provider-agnostic view of upstream rate-limit quota.
 * All reset values are absolute epoch milliseconds (normalized from
 * whichever format the provider uses — Go duration, integer seconds,
 * or RFC 3339 timestamp).
 */
export interface UpstreamQuotaSnapshot {
  credentialId: string;
  provider: "openai" | "anthropic" | "azure-openai" | "gemini" | "bedrock";

  /** Remaining requests in current window. null = provider did not report. */
  remainingRequests: number | null;

  /** Remaining tokens in current window. null = provider did not report. */
  remainingTokens: number | null;

  /** Max requests per window, if reported. null = unknown. */
  limitRequests: number | null;

  /** Max tokens per window, if reported. null = unknown. */
  limitTokens: number | null;

  /**
   * Absolute epoch ms when the request window resets.
   * Computed as: now + parsed-reset-duration (OpenAI/Azure) OR
   *               parsed RFC 3339 timestamp (Anthropic/Gemini).
   * null = provider did not report or sentinel (-1/0 from Azure bug).
   */
  resetRequestsMs: number | null;
  resetTokensMs: number | null;

  /**
   * Only set on 429 responses. Recommended backoff in ms.
   * OpenAI: not documented → derive from resetRequestsMs.
   * Anthropic: `retry-after` header × 1000.
   * Azure: `retry-after-ms` header (already in ms).
   * Gemini: `quotaResetDelay` from error body, parsed to ms.
   */
  retryAfterMs: number | null;

  /** ISO 8601 timestamp when this snapshot was captured. */
  capturedAt: string;
}
```

### Parser dispatch

Each `ProtocolAdapter` (in `types.ts`) gains an optional method:

```ts
export interface ProtocolAdapter {
  // ... existing methods ...

  /**
   * Parse rate-limit headers from an upstream response.
   * Return null if the provider does not expose rate-limit headers
   * (e.g. Bedrock) or if the response is missing them.
   *
   * For providers that embed quota in the error body (Gemini, Bedrock),
   * pass the parsed error body as the second arg.
   */
  parseRateLimitHeaders?(
    headers: Headers,
    errorBody?: unknown,
  ): Partial<UpstreamQuotaSnapshot> | null;
}
```

`upstream-rate-limits.ts` exports a dispatcher:

```ts
export function captureQuotaSnapshot(
  adapter: ProtocolAdapter,
  credentialId: string,
  provider: string,
  response: Response,
  errorBody?: unknown,
): UpstreamQuotaSnapshot | null {
  if (!adapter.parseRateLimitHeaders) return null;

  const parsed = adapter.parseRateLimitHeaders(response.headers, errorBody);
  if (!parsed) return null;

  return normalizeSnapshot(parsed, credentialId, provider);
}
```

### Per-provider parser design

#### OpenAI (`openai.ts`)

Headers (case-insensitive, but verbatim names):

- `x-ratelimit-limit-requests` → integer
- `x-ratelimit-limit-tokens` → integer
- `x-ratelimit-remaining-requests` → integer
- `x-ratelimit-remaining-tokens` → integer
- `x-ratelimit-reset-requests` → **Go `time.Duration` string** (e.g. `"1s"`, `"6m0s"`, `"17ms"`)
- `x-ratelimit-reset-tokens` → Go duration string
- `x-ratelimit-limit-project-tokens` (optional) → integer
- `x-ratelimit-remaining-project-tokens` (optional) → integer
- `x-ratelimit-reset-project-tokens` (optional) → Go duration

Parser must implement `parseGoDuration(s)`:

- Format: `([0-9]+(ns|us|µs|ms|s|m|h))+` (e.g. `6m0s`, `2h45m`, `17ms`)
- Convert to milliseconds: sum each segment.
- Reject malformed strings → return null (do not throw).

Reset computation: `resetRequestsMs = Date.now() + parseGoDuration(header)`.
Project-scoped headers are optional — only include if present.

#### Anthropic (`anthropic.ts`)

Headers:

- `retry-after` → integer seconds (only on 429)
- `anthropic-ratelimit-requests-limit` → integer
- `anthropic-ratelimit-requests-remaining` → integer
- `anthropic-ratelimit-requests-reset` → **RFC 3339 timestamp** (absolute, e.g. `"2026-05-18T10:15:00Z"`)
- `anthropic-ratelimit-tokens-limit` → integer
- `anthropic-ratelimit-tokens-remaining` → integer (rounded to nearest 1000 by provider — do not un-round)
- `anthropic-ratelimit-tokens-reset` → RFC 3339 timestamp
- `anthropic-ratelimit-input-tokens-limit/remaining/reset` (newer, optional)
- `anthropic-ratelimit-output-tokens-limit/remaining/reset` (newer, optional)

Parser:

- `resetRequestsMs = Date.parse(rfc3339)` (absolute, no addition).
- `retryAfterMs = parseInt(retryAfter) * 1000` (only if present).
- Prefer `anthropic-ratelimit-tokens-*` (most-restrictive binding limit) over input/output split; do NOT sum input + output (provider docs say the `tokens-*` headers are the binding limit, not the sum).
- `Date.parse` returns NaN for invalid input → return null for that field.

**Known real-world parser bug to avoid**: do not treat `anthropic-ratelimit-tokens-reset` as a Go duration (the sagentic-ai/sagentic-af repo does this and it's wrong — confirmed by Anthropic SDK test suite).

#### Azure OpenAI (`azure-openai.ts`)

Same header NAMES as OpenAI, but **different value formats**:

- `x-ratelimit-reset-requests` → plain integer (seconds), NOT Go duration
- `x-ratelimit-reset-tokens` → plain integer (seconds)
- `retry-after-ms` → integer milliseconds (only on 429, NOT `retry-after`)

Reset computation: `resetRequestsMs = Date.now() + parseInt(header) * 1000`.

**Sentinel handling**: Azure Responses API is known to return `-1` for `*-limit-*` and `0` for `*-reset-*` (confirmed Microsoft bug, [Q&A #5625878](https://learn.microsoft.com/en-us/answers/questions/5625878)). Parser must:

- Treat `limit === -1` → `limitRequests: null` (unknown, not -1).
- Treat `reset === 0` → `resetRequestsMs: null` (unknown, not 0 ms from now).
- Treat `remaining === -1` → `remainingRequests: null`.

Implementation: `azure-openai.ts` reuses the OpenAI header-name list but overrides the reset parser (int-seconds instead of Go-duration) and adds `retry-after-ms` handling. Do NOT just call `openai.parseRateLimitHeaders` — the value format is incompatible.

#### Google Gemini (`gemini.ts`)

No `x-ratelimit-*` headers on success responses. Only `x-gemini-service-tier` (string: `"standard"` | `"priority"`) — NOT a quota field; ignore for quota purposes.

On 429, the error body contains:

```json
{
  "error": {
    "code": 429,
    "status": "RESOURCE_EXHAUSTED",
    "details": [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      "reason": "QUOTA_EXHAUSTED",
      "metadata": {
        "quotaResetDelay": "49m30.938289688s",   // Go duration
        "quotaResetTimeStamp": "2026-04-10T01:47:33Z"  // RFC 3339
      }
    }, {
      "@type": "type.googleapis.com/google.rpc.RetryInfo",
      "retryDelay": "2970.938289688s"            // Go duration, seconds
    }]
```

Parser:

- On success: return null (no quota data).
- On 429: parse error body, extract `quotaResetDelay` (Go duration → ms) and `quotaResetTimeStamp` (RFC 3339 → epoch ms).
- Set `retryAfterMs = parseGoDuration(quotaResetDelay)`.
- Set `resetRequestsMs = Date.parse(quotaResetTimeStamp)` (prefer timestamp over delay if both present; they should agree).
- `remainingRequests` / `remainingTokens` / `limitRequests` / `limitTokens` = null (Gemini does not expose these).

Note: community claims of `x-ratelimit-*` headers on Gemini are **unverified** — official docs do not document them. Parser will not look for them. If a future Gemini API change adds them, the parser can be extended.

#### AWS Bedrock (`bedrock.ts`)

No `parseRateLimitHeaders` method exported — the adapter opts out. `captureQuotaSnapshot()` returns null for Bedrock credentials. Bedrock throttling continues to flow through the existing `RETRYABLE_STATUS` + `markCredentialFailure` path.

### Capture point

In `stream-proxy.ts:fetchUpstream()` (line 330), after the `fetch()` call returns the `Response` object but BEFORE the body is piped:

```ts
const upstreamRes = await fetch(url, init);

// NEW: capture quota snapshot from response headers
const snapshot = captureQuotaSnapshot(adapter, credential.id, provider, upstreamRes);

if (snapshot) {
  // Fire-and-forget: update Redis cache + Prometheus gauge
  await aiEndpointCredentialRepo.updateQuotaSnapshot(snapshot);
  metrics.upstreamRateLimitRemainingRequests.set(
    { credentialId: snapshot.credentialId, provider: snapshot.provider },
    snapshot.remainingRequests ?? -1,
  );
  // ... same for tokens
}

// existing stream-pipe logic continues unchanged
```

On 429 (in `relay.ts:854` / `consumer-relay.ts:1030` retry loop):

```ts
if (RETRYABLE_STATUS.has(upstreamRes.status)) {
  // NEW: capture 429-specific quota (retry-after, gemini error body)
  const errorBody = upstreamRes.status === 429 ? await upstreamRes.json().catch(() => null) : null;
  const snapshot = captureQuotaSnapshot(adapter, credential.id, provider, upstreamRes, errorBody);

  if (snapshot?.retryAfterMs) {
    // Honor the provider's backoff recommendation before retrying the next candidate.
    // Mark this credential as "cooling down" in Redis with TTL = retryAfterMs.
    await aiEndpointCredentialRepo.markCooldown(credential.id, snapshot.retryAfterMs);
  }

  markCredentialFailure(credential.id); // existing
  continue; // existing — try next candidate
}
```

### Redis schema

Use a dedicated Redis namespace `prismix:upstream-quota:{credentialId}` storing a JSON-serialized `UpstreamQuotaSnapshot` with TTL = `max(resetRequestsMs, resetTokensMs) - now` (clamped to 5 minutes max — prevents stale snapshots from lingering if a credential is rotated).

For cooldowns: `prismix:upstream-cooldown:{credentialId}` with TTL = `retryAfterMs` (clamped to 10 minutes max).

### Routing integration

In the existing 3-layer router (which selects the next upstream candidate), add a pre-filter:

```ts
// After candidate credentials are gathered, before the fetch loop:
candidates = candidates.filter((c) => {
  const cooldown = await redis.get(`prismix:upstream-cooldown:${c.id}`);
  return !cooldown;
});

// Within the loop, prefer credentials with higher remaining quota:
candidates.sort((a, b) => {
  const qa = await aiEndpointCredentialRepo.getQuotaSnapshot(a.id);
  const qb = await aiEndpointCredentialRepo.getQuotaSnapshot(b.id);
  const ra = qa?.remainingRequests ?? Infinity; // unknown → lowest priority
  const rb = qb?.remainingRequests ?? Infinity;
  return rb - ra; // descending
});
```

**Important**: the sort is advisory, not a hard filter. A credential with `remainingRequests === 0` is still tried if no other candidate exists — the provider may have refilled by the time the request lands. Only `prismix:upstream-cooldown:*` (set on 429) is a hard filter.

### Prometheus metrics

Add to `src/server/lib/metrics.ts`:

```ts
export const upstreamRateLimitRemainingRequests = new Gauge({
  name: "prismix_ai_upstream_rate_limit_remaining_requests",
  help: "Remaining requests in the current upstream rate-limit window, as reported by the provider. -1 = not reported.",
  labelNames: ["credentialId", "provider"],
});

export const upstreamRateLimitRemainingTokens = new Gauge({
  name: "prismix_ai_upstream_rate_limit_remaining_tokens",
  help: "Remaining tokens in the current upstream rate-limit window, as reported by the provider. -1 = not reported.",
  labelNames: ["credentialId", "provider"],
});

export const upstreamCooldownActive = new Gauge({
  name: "prismix_ai_upstream_cooldown_active",
  help: "1 if the credential is in provider-requested cooldown (Retry-After), 0 otherwise.",
  labelNames: ["credentialId", "provider"],
});
```

Convention: `-1` sentinel for "provider did not report" (matches Azure's existing bug convention and is Prometheus-safe — gauges accept negative values).

## Edge cases & sentinels

| Case                                                               | Handling                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Azure Responses API returns `limit=-1`, `reset=0`                  | Normalize to `null` (unknown), do not set gauge to -1 / 0.                                 |
| Anthropic `tokens-remaining` rounded to nearest 1000               | Accept as-is; do not un-round. Document in field JSDoc.                                    |
| Anthropic reset timestamp in the past (clock skew)                 | Clamp `resetRequestsMs` to `max(parsed, Date.now() + 1000)` — minimum 1s forward window.   |
| Gemini 429 with no `quotaResetDelay` (older API version)           | Fall back to exponential backoff (existing behavior).                                      |
| Bedrock 429                                                        | No headers to parse → existing `markCredentialFailure` + retry path. No cooldown set.      |
| Network error before headers received                              | No capture possible → no snapshot update. Existing retry path handles it.                  |
| Header present but malformed (non-integer, unparseable duration)   | Return null for that field, log warn-level. Do not throw.                                  |
| Credential rotated / deleted                                       | Stale snapshot expires via TTL. No cleanup needed.                                         |
| Multiple concurrent requests update the same credential's snapshot | Last-writer-wins is acceptable (provider headers are the source of truth, not our counts). |

## Testing strategy

1. **Unit tests** for each parser (`upstream-rate-limits.test.ts`):
   - OpenAI: feed real captured headers (from the librarian's sample), assert normalized snapshot.
   - OpenAI: Go duration parser — `1s`, `6m0s`, `17ms`, `2h45m`, malformed.
   - Anthropic: RFC 3339 parser — valid, invalid, past timestamp.
   - Anthropic: verify `tokens-reset` is NOT parsed as Go duration (regression test for the sagentic-ai bug).
   - Azure: int-seconds reset, `retry-after-ms`, `-1`/`0` sentinels.
   - Gemini: 429 error body parsing, both `quotaResetDelay` and `quotaResetTimeStamp`.
   - Bedrock: returns null.

2. **Integration test**: mock upstream `fetch()` returning headers, assert `captureQuotaSnapshot()` writes to Redis and updates Prometheus.

3. **E2E test** (deferred): requires real provider credentials — not in CI. Document as a manual verification runbook.

## Phased rollout

### Phase 1 — Parse + observe (this design)

- Implement parsers for OpenAI, Anthropic, Azure, Gemini.
- Capture in `fetchUpstream()` + 429 retry loop.
- Write to Redis + Prometheus.
- **No routing changes yet** — observe only. Compare captured remaining vs. actual 429s to validate parser correctness.

### Phase 2 — Cooldown enforcement

- Set `prismix:upstream-cooldown:{credentialId}` on 429 with `retry-after`/`retry-after-ms`/`quotaResetDelay`.
- Filter candidates by cooldown in the router.
- This is the smallest safe behavioral change — honor provider's explicit backoff request.

### Phase 3 — Quota-aware routing

- Sort candidates by `remainingRequests` (descending, unknown → lowest priority).
- Soft preference only — does not hard-filter.
- Requires Phase 1 validation data to confirm parser accuracy.

### Phase 4 (optional) — Persisted snapshots

- Add `lastKnownQuota JSONB` column to `ai_endpoint_credentials` (Drizzle migration).
- Async write-through from Redis → Postgres (debounced, 1/min per credential).
- Enables admin UI to show "current provider quota" per credential.
- Out of scope for this design.

## Risks & mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser bug causes false "quota exhausted" → blocks valid credentials | Phase 1 is observe-only (no routing impact). Validate against real 429 data before Phase 2/3.                                                                                                                   |
| Provider changes header format                                       | Per-adapter parsers are isolated; adding a new format is a one-file change. Sentinel handling (null) prevents crashes.                                                                                          |
| Redis write amplification (every response writes a snapshot)         | TTL-based expiry; snapshot is small (~200 bytes JSON). At 1000 RPS, this is 1000 Redis SETEX/s — well within Redis capacity. If needed, debounce to 1 update per credential per 5s.                             |
| Clock skew between Prismix server and provider                       | Anthropic timestamps are absolute; clamp to min 1s forward. OpenAI/Azure durations are relative (now + duration) — robust to skew.                                                                              |
| Azure `-1`/`0` sentinel misinterpreted as real quota                 | Explicit sentinel normalization in `azure-openai.ts` parser → `null`.                                                                                                                                           |
| Bedrock has no data → routing treats it as "lowest priority"         | Phase 3 sort uses `Infinity` for unknown (lowest priority). Document that Bedrock credentials will sort last. Mitigation: also sort by recent 429 rate (existing `markCredentialFailure` data) as a tiebreaker. |

## Resolved decisions (locked by user 2026-07-03)

1. **Scope**: Implement Phase 1 + Phase 2 + Phase 3 in this engagement (all three phases). No feature-flag gate between phases — but Phase 1 must typecheck/test green before Phase 2 begins, and Phase 2 before Phase 3.
2. **Cooldown max cap**: 10 minutes. `retryAfterMs` passed to `markCooldown` is clamped: `Math.min(parsed, 10 * 60 * 1000)`. Anthropic (5-60s) and OpenAI (none) never hit the cap. Gemini `quotaResetDelay` (~50min) WILL be clamped to 10min — this is intentional to avoid a single 429 blocking a credential for an hour.
3. **Bedrock**: Keep existing retry path. No parser, no virtual quota, no cooldown. `bedrock.ts` does NOT export `parseRateLimitHeaders`. Bedrock 429s continue through `RETRYABLE_STATUS` + `markCredentialFailure`.

## Sources

- OpenAI headers: https://developers.openai.com/api/docs/guides/rate-limits — section "Rate limits in headers".
- OpenAI Realtime: https://developers.openai.com/api/docs/api-reference/realtime-server-events — `RateLimitsUpdatedEvent` (out of scope).
- Anthropic headers: https://platform.claude.com/docs/en/api/rate-limits — section "Response headers".
- Anthropic SDK: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/core/error.ts — `RateLimitError.headers`.
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits.
- Gemini priority tier / `x-gemini-service-tier`: https://ai.google.dev/gemini-api/docs/generate-content/priority-inference.
- Azure OpenAI headers: https://learn.microsoft.com/azure/ai-services/openai/how-to/quota — section "Rate limit response headers".
- Azure known bug: https://learn.microsoft.com/en-us/answers/questions/5625878/azure-openai-responses-api-x-ratelimit-headers-val.
- AWS Bedrock InvokeModel: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html — "Response Syntax".
- AWS Bedrock quotas: https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-runtime.html.
- Bedrock no passthrough confirmation: https://github.com/anthropics/claude-code/issues/60502.
