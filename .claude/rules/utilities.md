# Utility Rules

## lodash-es — Mandatory

All utility ops use `lodash-es` named imports. Both server and web.

❌ `import _ from "lodash"` — default import.
❌ `import { x } from "lodash"` — non-ESM.
❌ `[...new Set(arr)]` — use `uniqBy`.
❌ `arr.sort((a,b) => ...)` — use `orderBy`/`sortBy`.

## Number (`@/shared/number.ts`) — Mandatory

All number formatting, arithmetic, comparison via `number.ts`. If function doesn't exist, add it there first.

❌ `Number(x).toFixed(2)` / `parseFloat(x.toFixed(4))` — use `removeTailingZero`.
❌ Inline BigNumber arithmetic — use `safePlus`/`safeMinus`/etc.
❌ `a > b ? a : b` for numeric comparison — use `gt()`/`lt()`.

## Dates

`date-fns` for relative (`formatDistanceToNow`). `new Date(ts).toLocaleString()` for absolute.
