# Postman Sync Rules

After any API endpoint change (add/remove/modify path/body/auth/params), run `/sync-postman`.
Files: `docs/postman/prismix-collection.json` + `prismix-environment.json`.
Skip for frontend-only, i18n, test, or refactor changes.
