# Prismix Docker Compose stack

Production stack for the Tokyo host:

```text
Cloudflare (prismix.live)
        │ tunnel
        ▼
cloudflared ──► prismix:3403 ──► postgres
                              └─► redis
```

No host ports are exposed publicly; the app is published only on `127.0.0.1:3403` for diagnostics.

## Image

GitHub Actions builds `linux/amd64` and pushes:

- `ghcr.io/starriv/prismix:latest`
- `ghcr.io/starriv/prismix:sha-<commit>`

Use the immutable `sha-*` tag in production. The image is public, so the server can pull anonymously.

Workflow: `.github/workflows/docker.yml`.

## Required files on the server

| Path                               | Purpose                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `/opt/prismix-docker/compose.yaml` | this stack                                                |
| `/opt/prismix-docker/.env`         | `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `IMAGE_TAG` (0600) |
| `/etc/prismix/prismix.env`         | application secrets (0600)                                |
| `/etc/cloudflared/docker.yml`      | tunnel ingress to `http://prismix:3403`                   |
| `/etc/cloudflared/<uuid>.json`     | tunnel credentials (root-readable)                        |

`.env` template:

```sh
cp .env.example .env
chmod 600 .env
```

## Start

```bash
docker compose --project-directory /opt/prismix-docker pull
docker compose --project-directory /opt/prismix-docker up -d
docker compose --project-directory /opt/prismix-docker ps
curl http://127.0.0.1:3403/api/health
```

PostgreSQL 18 stores data under `/var/lib/postgresql` (not `/var/lib/postgresql/data`). The named volume is mounted at the former.

## Update

```bash
cd /opt/prismix-docker
# pick the sha tag from the GitHub Actions run
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=sha-xxxxxxxx/' .env
docker compose pull prismix
docker compose up -d prismix cloudflared
docker compose ps
```

## Back up

```bash
docker compose --project-directory /opt/prismix-docker exec -T postgres \
  pg_dump -U prismix -d prismix --format=custom --no-owner --no-privileges \
  > /var/backups/prismix/prismix_$(date +%Y%m%d_%H%M%S).dump
```

The host cron runs this daily at 03:17 and keeps 14 days.

## Restore into a fresh stack

```bash
docker compose --project-directory /opt/prismix-docker up -d postgres redis
docker compose --project-directory /opt/prismix-docker exec -T postgres \
  pg_restore -U prismix -d prismix --no-owner --no-privileges < backup.dump
docker compose --project-directory /opt/prismix-docker up -d prismix cloudflared
```

## Notes

- `DATABASE_URL` and `REDIS_URL` are overridden by Compose to use service names; other app secrets come from `/etc/prismix/prismix.env`.
- Redis persistence is enabled; `maxmemory` is 256 MB with `noeviction` because BullMQ requires it.
- The native PostgreSQL/Redis/Node services are disabled after migration but their data is retained for rollback.
