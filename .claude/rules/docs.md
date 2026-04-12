# Docs Site Rules

Public docs at `/docs`. React pages with `t()` — **no markdown renderer**.
Text → `t("docs.<section>.<key>")`. Code blocks → literal strings in `<CodeBlock>`.
Source: `docs/public/` (EN + ZH markdown) is upstream. Docs site distills (not copies) into user-facing pages.

New page: source md → distill i18n keys → create page with `DocSection`/`CodeBlock` → add sidebar nav → add route.
When `docs/public/` updates: diff against React page, distill changes into `t()`, update both locales.
