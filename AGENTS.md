# Prismix Agent Rules

## Mandatory Web UI Verification

These rules are mandatory for every local web/UI change in this repository.

- Treat any change that can affect rendered UI as a web UI change. This includes `src/web/**`, shared UI components, route/layout files, CSS/Tailwind classes, visual assets, displayed i18n strings, browser auth flow, and API changes whose result is visible in the frontend.
- After making a web UI change, run the local app and verify it in a real browser before presenting the work as done. Static review, unit tests, typecheck, and headless API checks are not substitutes.
- Use Playwright or the Codex in-app browser against the local dev server. Exercise the changed screen or workflow end to end, including authenticated states when relevant.
- When authentication is needed, obtain a fresh local token from the database-backed dev helper instead of asking the user to sign SIWE manually:
  `pnpm dev:auth-token -- --role admin` or `pnpm dev:auth-token -- --role user`.
  For automated Playwright checks, prefer `--storage-state /tmp/prismix-<role>-state.json` and pass that file to `browser.newContext({ storageState })`. Do not paste token values into final responses or committed docs.
- For standard local page checks, prefer `pnpm verify:web -- --url <local-url> --role admin --expect-text "<visible text>"`. Use `--mobile` or repeated `--viewport WIDTHxHEIGHT` when layout matters.
- Do not work around browser security policy to inject auth. In the Codex in-app browser, do not use `evaluate` or `javascript:` URLs to write `localStorage`; use an already signed-in browser, user-completed SIWE, or a Playwright context with storage state.
- Check the browser console and failed network requests. For responsive or layout-sensitive changes, verify at least one desktop viewport and one mobile viewport.
- If browser verification cannot be completed, state the blocker clearly and do not claim the UI change is accepted or complete.
- Final reporting for web UI changes must include the local URL, auth role used, viewports/workflows tested, console/network result, and any remaining gaps.
- A web UI change is not accepted until the user explicitly approves it after local browser verification.
