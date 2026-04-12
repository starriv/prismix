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
