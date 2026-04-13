# API Layer Rules

All HTTP in `src/web/` goes through `@tanstack/react-query` + `zod` typed client. No exceptions.

❌ `fetch()` / `axios` anywhere in `src/web/` except `client.ts` / `admin-client.ts`.
❌ Hardcoded URL strings — use `constants.ts`.
❌ Inline query keys — use `queryKeys` from `query-keys.ts`.
❌ Client helpers called directly in components — use `useQuery`/`useMutation`. Exception: fire-and-forget in `useEffect` cleanup.

Schema naming: `<entity>Schema`, `<action><Entity>Body`.
Hook naming: `use<Entity>` (query), `use<Action><Entity>` (mutation).
Mutations invalidate related keys in `onSuccess`.
Always destructure with defaults: `const { data: items = [] } = useItems()`.

## Query Keys

`queryKeys` must include every parameter that changes the request URL or response set.
If a hook adds a new filter / search / pagination / sort parameter, update both:

- the request builder in the hook
- the corresponding key in `query-keys.ts`

Otherwise React Query may reuse the old cache entry and no network request will fire after the UI changes.

Checklist when adding a query param:

- hook params type updated
- `URLSearchParams` population updated
- matching `queryKeys.*` signature updated
- all values that affect backend filtering included in the returned key tuple

❌ Add `userUuid` to the hook URL but forget to add it to the query key.
❌ Add a new search field in the page and only update local state + hook params.
