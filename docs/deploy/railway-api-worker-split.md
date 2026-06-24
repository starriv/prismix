# Railway API / Worker Split

Prismix supports running the HTTP API and background worker as separate Railway services from the same repository.

## Services

### API service

Use the root `railway.toml`.

```toml
[deploy]
startCommand = "ROLE=api pnpm start"
healthcheckPath = "/api/health"
```

Bind the public domain to this service. After the worker service is healthy, scale this service to 2+ replicas.

> **Note on multi-replica backpressure**: The write-queue depth limit (`maxWriteQueueDepth`) is tracked per-process, not in Redis. With N API replicas, the effective Redis queue depth can reach `N × maxWriteQueueDepth` before backpressure triggers. For 2 replicas this is acceptable; beyond that, monitor Redis queue depth externally (e.g. BullMQ `getWaitingCount`) and raise `maxWriteQueueDepth` only if the worker can keep up.

### Worker service

Create a second Railway service from the same repository and use `deploy/railway/worker.toml`, or copy these settings into the service dashboard.

```toml
[deploy]
startCommand = "pnpm start:worker"
healthcheckPath = "/health"
```

Do not bind a public domain to the worker service. All scheduled jobs use BullMQ repeatable jobs with a shared `jobId`, so the worker can be scaled to multiple replicas — each repeatable job fires once system-wide regardless of replica count.

## Job queues

The API is a **producer** (`startWorker: false`) and the worker is the **consumer**. Two BullMQ queues back the async write path:

- `write-queue` — single-item jobs (notifications, webhooks, key touches, revenue-share txns). Worker concurrency 5.
- `write-queue-batch` — high-frequency micro-batched jobs (`ai-usage-log`). Worker concurrency is set well above the batch `maxSize` so a full batch can assemble and flush by size instead of being throttled to one flush per timer interval.

In single-process mode (`ROLE=all`) batch jobs are buffered in-process and never touch Redis. In the split, the API enqueues each `ai-usage-log` to `write-queue-batch` and the worker re-batches them into a single multi-row INSERT. Keeping the batch on a dedicated high-concurrency queue prevents analytics writes from starving critical single-item jobs (billing, notifications) on the shared queue.

## Shared environment

Both services must point at the same infrastructure:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY` and `ENCRYPTION_SALT`, if configured
- blockchain/provider variables used by top-up scanning and notifications

The worker needs `JWT_SECRET` today because some encrypted values may still use it as the fallback secret when `ENCRYPTION_KEY` is not set.

## Verification

1. Deploy the worker service and confirm `/health` returns `200`.
2. Deploy the API service and confirm `/api/health` returns `200`.
3. Trigger an AI relay request and confirm usage/request logs are written by the worker.
4. Create a top-up order and confirm `deposit-scan` jobs are consumed by the worker.
5. Confirm API logs do not contain worker job startup lines.
6. Scale only the API service replicas.
