---
name: prismix-web-ui-verification
description: Mandatory Prismix browser verification for web UI changes. Use when modifying or reviewing frontend-rendered behavior, including src/web files, shared UI components, routes, layouts, CSS/Tailwind classes, visual assets, displayed i18n strings, browser auth flows, or frontend-visible API behavior.
---

# Prismix Web UI Verification

## Requirement

Verify every local web UI change in a real browser against the local dev server before claiming it is done. The change is accepted only after the user approves the browser-verified result.

## Workflow

1. Identify the affected route, workflow, user role, and viewport risk.
2. Start or reuse the local stack, usually `pnpm dev`.
3. Prefer the verification script for local pages:
   `pnpm verify:web -- --url <local-url> --role admin --expect-text "<visible text>"`
4. Add `--mobile` or repeated `--viewport WIDTHxHEIGHT` for layout-sensitive work.
5. If the script is insufficient, open the surface manually in Playwright or the Codex in-app browser and exercise the real workflow, not only initial page load.
6. Run typecheck/tests as useful, but never as a substitute for browser verification.

## Auth

`pnpm verify:web` generates and cleans a database-backed Playwright storage state automatically. For manual authenticated Playwright checks, generate one explicitly:

```bash
pnpm dev:auth-token -- --role admin --storage-state /tmp/prismix-admin-state.json
pnpm dev:auth-token -- --role user --storage-state /tmp/prismix-user-state.json
```

Use the file with `browser.newContext({ storageState: "/tmp/prismix-admin-state.json" })`. Add `--id`, `--address`, `--email`, or `--origin http://localhost:5189` when needed.

Do not paste token values into final responses or docs. Clean temporary token files from `/tmp` after use. If token generation fails, inspect `.env.local`, `DATABASE_URL`, `JWT_SECRET`, and whether matching rows exist in `admins` or `users`.

If using the Codex in-app browser, use it when it is already signed in or the user can complete SIWE manually. Do not inject auth with `tab.playwright.evaluate(...)` or `javascript:` URLs: the runtime uses a read-only page scope for `evaluate`, and script URLs are blocked by browser security policy.

## Report

- local URL and final URL
- role used and identity summary, without token values
- tested workflow and viewports
- visible heading/content proving the requested page rendered
- relevant API response statuses
- `requestfailed` entries
- console errors and warnings
- screenshot path, if visual confirmation matters
- blockers or unverified surfaces
- whether final acceptance is still pending user approval
