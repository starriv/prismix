---
name: sync-postman
description: "Sync Postman collection after API changes. Diffs route files against collection, adds/removes/updates requests. Trigger: \"sync postman\"."
---

# Sync Postman Collection

Keep `docs/postman/prismix-collection.json` and `prismix-environment.json` in sync with API routes.

## Steps

1. Read `src/server/routes/index.ts` — get all mount paths and route files
2. Scan each route file: extract HTTP method, full path, auth requirement, request body shape
3. Read current `docs/postman/prismix-collection.json` — diff against scanned routes
4. Add missing endpoints, remove stale ones, update changed paths/bodies/auth
5. If new env variables needed, add to `prismix-environment.json`
6. Validate JSON: `node -e "const c=require('./docs/postman/prismix-collection.json'); ..."` — count requests
7. Report: table of added/removed/updated with counts

## Conventions

- Collection format: Postman v2.1
- Folder-level auth (don't repeat on individual requests): merchant JWT `{{merchantToken}}`, admin JWT `{{adminToken}}`, agent API key `{{agentApiKey}}`
- Auth endpoints must have test scripts that save tokens to environment
- Content-Type header on all POST/PUT
- Request bodies use realistic placeholder values, not empty objects
- Path variables: `{{baseUrl}}`, `{{resourceId}}`, `{{agentId}}`, etc.
- Environment secrets use `"type": "secret"`
