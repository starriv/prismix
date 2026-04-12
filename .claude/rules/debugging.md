# Web Debugging Rules

For frontend bugs: **Chrome DevTools MCP first, never guess.**

Flow: `navigate_page` → `list_network_requests` → `list_console_messages` → `evaluate_script` → locate code from evidence.

## Known Gotchas

| Gotcha | Lesson |
|--------|--------|
| Shared hook calls authed API across contexts | Shared hooks must use public API only. Real case: `useChainRegistry` triggered 401 on admin page |
| `window.location.href` hard redirect | Bypasses React Router. Grep for all sources |
| wagmi `isConnected` hydration race | Use useRef for prev value, only trigger logout on `true→false` |
| `AuthProvider` scope leak | Merchant AuthProvider wraps merchant routes only; admin is separate |
| Zod schema mismatch | Server new field + stale schema → parse fail → clear token → redirect |

401/redirect debug: check which client (merchant vs admin), localStorage token + JWT exp, shared hooks crossing context boundaries.
