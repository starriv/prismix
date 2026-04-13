# Detail Panel (Sheet) Rules

Card-based grouping. One Card per concern. Order: Hero → Info → Settings → Actions → Security → Lists → History (last).

## Hero Card

No CardHeader. `CardContent pt-4`. Top-left: label, center-left: value `text-2xl font-bold`, top-right: status + Switch, bottom: copyable identifier.
All wallet addresses: **`WalletAddress` component mandatory** (first 6 + last 6 `text-green-600`).
External business identifiers such as `uuid`, `requestId`, order numbers, and consumer-facing IDs are full identifiers by default:

- show the full value unless the product requirement explicitly says to shorten it
- keep the value copyable
- use `font-mono`
- prevent layout breakage with `min-w-0`, `break-all`, and non-shrinking action buttons where needed

Do not silently replace a full business identifier with a prefix for convenience.

## Grouped Cards

`CardHeader pb-3` + `CardTitle text-sm` + `CardContent space-y-3`. Compact grids: `grid grid-cols-3 gap-3`.

## List Cards

Row: `rounded-lg border bg-muted/30 px-3 py-2`. Icon: `h-8 w-8 rounded-md bg-primary/10`. Title with count Badge.

## Spacing

Cards: `space-y-5`. Card content: `space-y-3`. Grid: `gap-3`. List: `gap-2`.
Inline action icons: `h-3.5 w-3.5` + `ghost icon h-5 w-5`. Card buttons: `h-4 w-4 mr-1` + `size="sm"`.

❌ Flat fields without card grouping.
❌ Read-only and form inputs in same block.
❌ Single card with 5+ unrelated fields.
❌ Showing only the first 8 chars of a UUID in admin UI unless the full value is also visible/copyable nearby.
