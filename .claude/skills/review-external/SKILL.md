---
name: review-external
description: 'Review and accept external modifications to the working tree (Codex, linters, collaborators). Diff, assess, flag issues. Trigger: "review changes", "review external", "check what changed".'
---

# Review External Changes

Review uncommitted modifications made by external tools (Codex, linters, collaborators) to the working tree. Read-first, then assess.

## Steps

1. **Diff** — Run `git diff` (unstaged) and `git diff --cached` (staged). If both empty, report "no changes" and stop.

2. **Inventory** — List changed files grouped by layer:
   - Server: `src/server/`, `src/blockchain/`, `src/shared/`
   - Web: `src/web/`
   - Config/deploy: `.env*`, `deploy/`, `Dockerfile`, `docker-compose*`
   - Other: everything else

3. **Per-file review** — For each changed file, Read the current version and assess:
   - **Correctness**: Does the change break existing logic? Type errors? Missing imports?
   - **Project rules**: Violations of `.claude/rules/` (ts-pattern, lodash-es, i18n, etc.)?
   - **Regressions**: Did the external tool revert or undo intentional changes?
   - **Improvements**: Acknowledge good optimizations (memoization, dedup, cleaner logic).

4. **Type check** — Run `npx tsc --noEmit`. Report any errors.

5. **Report** — Output a concise summary table:

```
| File | Verdict | Notes |
|------|---------|-------|
| ... | LGTM / Issue / Reverted | ... |
```

6. **Fix** — If issues are found, ask the user whether to fix them. Do not auto-fix.

## Rules

- Do NOT revert external changes unless they introduce bugs or rule violations.
- If the external tool removed code you previously added, check whether the removal was an improvement (redundant method, simpler approach) or a regression (lost functionality).
- Treat the external modification as intentional unless evidence says otherwise.
