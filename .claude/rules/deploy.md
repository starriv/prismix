# Deploy Sync Rules

After code changes, sync deploy files if affected:

| Change | Update |
|---|---|
| Env var added/changed | `.env.example` files + docs site |
| Port / server entry | `Dockerfile`, `docker-compose.yml`, `Caddyfile` |
| Native npm dependency | `Dockerfile` |
| Health check endpoint | `Dockerfile`, `docker-compose.yml` |

Verify: Dockerfile deps match code, `.env.example` complete, health check endpoint valid.
