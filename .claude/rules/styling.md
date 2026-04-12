# Styling Rules

## Stack

Tailwind CSS v4 (via `@tailwindcss/vite`, no config file). `cn()` from `@/web/shared/utils`. CVA for variants. shadcn/ui + Radix UI. `data-slot="<name>"` on component roots.

## UI Components — Use, Don't Reimplement

Always use `src/web/components/ui/`. If missing, add from shadcn first.

| Instead of | Use |
|---|---|
| Raw `<button>`/`<input>`/`<select>`/`<table>` | `Button`/`Input`/`Select`/`Table` |
| `<input type="checkbox">` | `Checkbox` or `Switch` |
| `useState` + conditional render | `Collapsible` or `Dialog` |
| `confirm()`/`createPortal` | `Dialog` or `Sheet` |
| `title` attribute | `Tooltip` |
| Manual dropdown | `DropdownMenu` or `Popover` |
| Manual toast | `toast()` from Sonner |
| Manual wallet address display | `WalletAddress` (mandatory for all addresses) |
| `type="password"` for secrets | `SecretInput`. Exception: login page uses `type="password"` + `autoComplete="current-password"` |

## Dialog & Sheet

Height constrained via `DialogBody`/`SheetBody`. `preventClose`: form Dialogs yes, Sheets never.
Sheet width: `w-[480px]` or `w-[520px]` (never default). `SheetBody` has padding — don't add `px-4`.
`SelectTrigger` in forms: always `className="w-full"`.

## Tabs

Vertical stack only. `TabsList` on top, `TabsContent` below. Never side-by-side.

## Page Width

Dashboard pages fill available width. Multiple cards: `auto-fill` grid `minmax(320px, 1fr)`. Single card: `space-y-6`. `max-w-*xl` for homepage only.

## Colors

Semantic tokens by default. Raw colors for status only: green (active), yellow (warning), red (error), blue (primary category), outline (neutral).

❌ Purple, violet, pink, fuchsia, gradients — conflicts with fintech design language.
