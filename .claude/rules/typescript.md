# TypeScript Rules

❌ `.js` extensions in imports — bundler resolution.
❌ `any` for caught errors — use `unknown` + narrow.
❌ Non-`@/` paths for project imports — always `@/*`.
Use `import type` for type-only imports.
