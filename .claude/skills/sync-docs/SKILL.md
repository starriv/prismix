---
name: sync-docs
description: "Sync docs site from docs/public/ source files. Diffs upstream markdown against React pages + i18n keys. Trigger: \"sync docs\"."
---

# Sync Docs Site

Compare `docs/public/*.md` (canonical source) against docs site React pages. Distill changes — never copy verbatim.

## Steps

1. `ls docs/public/*.md` — discover source files
2. For each source file, find matching `src/web/pages/docs/<slug>.tsx` and `docs.<prefix>.*` i18n keys
3. Diff section-by-section: new sections, stale content, removed sections, changed code blocks
4. Report gap table per file (section | status ✅⚠️❌ | action needed)
5. Apply updates: distill into `t()` calls, update both `en.json` + `zh.json`, update `.tsx` if structural changes needed
6. `pnpm test:unit` to verify

## Rules

- **Distill, don't copy** — source is technical, page is user-friendly
- Always update both locale files
- Use existing helpers: `DocSection`, `CodeBlock`, `BulletItem`, `OpBlock`
- Code blocks are literal strings (no i18n)
- If source file has no matching page, report to user — don't auto-create
