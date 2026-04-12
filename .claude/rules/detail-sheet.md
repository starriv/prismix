# Detail Panel (Sheet) Rules

Card-based grouping. One Card per concern. Order: Hero → Info → Settings → Actions → Security → Lists → History (last).

## Hero Card

No CardHeader. `CardContent pt-4`. Top-left: label, center-left: value `text-2xl font-bold`, top-right: status + Switch, bottom: copyable identifier.
All wallet addresses: **`WalletAddress` component mandatory** (first 6 + last 6 `text-green-600`).

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
