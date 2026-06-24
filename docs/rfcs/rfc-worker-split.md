# RFC: API 与 Worker 进程分离

- **Status**: Draft v1
- **Date**: 2026-06-24
- **Author**: Starriv + Sisyphus
- **Related**: `docs/rfcs/rfc-supplier-health-check.md`（该 RFC 已为多实例部署做了 BullMQ repeatable 设计，本 RFC 落地后其 setInterval 相关讨论需同步更新）

## Problem

当前 `src/server/index.ts` 在一个 Node 进程里同时承载 HTTP API 和所有后台任务（4 个 BullMQ Worker + 3 个 setInterval 定时器 + event bus 订阅 + 全部 write handler）。`bootstrap()` 一次性启动全部组件。

```
serve({ port }) → bootstrap() → 全部启动
                                 ├── HTTP server + routes + static
                                 ├── 4 个 BullMQ Worker
                                 │   ├── write-queue (concurrency 5) — 计费、日志、touch
                                 │   ├── deposit-scan (concurrency 3) — 充值扫描
                                 │   ├── supplier-health-check (concurrency 1)
                                 │   └── limited-free-model-expiry (concurrency 1)
                                 ├── 3 个 setInterval 定时任务
                                 │   ├── expire-topup-orders (10 min)
                                 │   ├── refresh-litellm-pricing (6h)
                                 │   └── retry-webhook-deliveries (10s)
                                 ├── event bus 订阅
                                 └── 全部 write handler 注册（notification/webhook/ai-relay/api-key-touch）
```

### 问题清单

1. **单点故障** — 任一 Worker 崩溃（OOM / 未捕获异常）→ 整个 API 一起挂，网关不可用
2. **资源竞争** — API 高负载时 Worker 抢 CPU → 网关流式延迟抖动；Worker 批量处理时 → API 响应变慢
3. **无法独立扩缩容** — 网关 QPS 峰值和 job 积压峰值不重合，但只能一起扩容
4. **部署耦合** — 改一行 job 代码要重启 API，影响在线请求
5. **可观测性混淆** — API 日志和 Worker 日志混在一个进程，难以区分延迟来源

## Core Insight

> **API 是 producer（只 enqueue），Worker 是 consumer（只 process）。两进程通过 Redis (BullMQ) + Postgres 通信，无进程内共享状态。**

这是当前代码库已有的隐式架构 —— `enqueueJob()` 把写入推到 BullMQ，handler 异步消费。只是 producer 和 consumer 恰好跑在同一进程。分离它们是「把隐式架构显式化」，不需要引入新的进程间通信机制。

## Goals

- API 进程只跑 HTTP server + enqueue（producer），不启动任何 BullMQ Worker / setInterval
- Worker 进程只跑 4 个 BullMQ Worker + 3 个 setInterval + write handler 注册（consumer）
- 两进程在 Railway 上作为独立 Service 部署，独立重启、独立扩缩容、独立日志
- 同一 repo / 同一 build 产物，仅 `startCommand` 不同
- 本地 dev 仍可单进程跑全部（`pnpm dev` 行为不变）
- 零功能回归，零数据迁移

## Non-Goals

- 不引入新的 IPC 机制（gRPC / RabbitMQ / Kafka 等）—— 复用 Redis BullMQ
- 不重构现有 job 的内部逻辑（handler 实现、重试策略保持不变）
- 不迁移 setInterval 任务到 BullMQ repeatable（虽然理想，但超出本次范围 —— 本次只做进程分离，不改变任务调度机制）
- 不做 Worker 水平扩容（多副本）—— 留待后续，本次单副本即可

---

## Design

### 1. 目标架构

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  Railway Service: api       │     │  Railway Service: worker     │
│  start: pnpm start          │     │  start: pnpm start:worker    │
│                             │     │                              │
│  HTTP server (Hono)         │     │  4 BullMQ Workers            │
│  Routes + middleware        │     │  3 setInterval timers        │
│  enqueueJob() (producer)    │───▶ │  write handler 注册          │
│  event bus (publish)        │     │  event bus (subscribe)       │
│  Queue-only (no Worker)     │     │  Queue + Worker              │
└──────────────┬──────────────┘     └──────────────┬───────────────┘
               │                                    │
               └──────────┬─────────────────────────┘
                          ▼
              ┌───────────────────────┐
              │  PostgreSQL (shared)  │
              │  Redis (shared)       │  ← BullMQ 队列 + 事件总线
              └───────────────────────┘
```

**关键原则**：

- API 进程：建 Queue（用于 enqueue），不建 Worker（不消费）
- Worker 进程：建 Queue + Worker（消费）
- 两者共享同一个 Postgres + Redis（Railway 上引用同一个 database service 的变量）
- 无进程内共享状态 —— 所有跨进程通信走 Redis（BullMQ job + pub/sub event bus）或 Postgres

### 2. 任务归属矩阵

当前 `bootstrap()`（`src/server/lib/bootstrap.ts:105-152`）做了 20 件事，按进程拆分：

| 步骤                                           | bootstrapApi() | bootstrapWorker() | 说明                                                         |
| ---------------------------------------------- | :------------: | :---------------: | ------------------------------------------------------------ |
| `initDb()`                                     |       ✅       |        ✅         | 两进程都读写 DB                                              |
| `initJwtSecret()`                              |       ✅       |        ❌         | Worker 不签发/校验 JWT                                       |
| `initRedis()`                                  |       ✅       |        ✅         | cache / rate-limit / event bus 都需要                        |
| `initBlockchainConfig()`                       |       ✅       |        ✅         | Worker 的 deposit-scan 需要 viem client                      |
| `initGatewayConfig()`                          |       ✅       |        ✅         | Worker 的 `initWriteQueue` 读 `maxWriteQueueDepth`           |
| `cleanExpiredRefreshTokens()`                  |       ✅       |        ❌         | API 专属清理                                                 |
| `initAuthProviderConfig()`                     |       ✅       |        ❌         | API 专属（登录策略）                                         |
| `initNotificationProviderConfig()`             |       ✅       |        ✅         | Worker 的 notification-deliver handler 读渠道配置            |
| `initWriteQueue({ startWorker: false })`       |       ✅       |         —         | API 只建 Queue 用于 enqueue                                  |
| `initWriteQueue()`                             |       —        |        ✅         | Worker 建 Queue + Worker 消费                                |
| `initNotificationQueue()`                      |       ❌       |        ✅         | 注册 notification-deliver handler                            |
| `initApiKeyTouchQueue()`                       |       ❌       |        ✅         | 注册 api-key-touch handler                                   |
| `initWebhookDeliveryHandler()`                 |       ❌       |        ✅         | 注册 webhook-deliver handler                                 |
| `initAiAdapters()`                             |       ✅       |        ❌         | API 路由层需要 provider adapter（转码、鉴权）                |
| `initAiWriteHandlers()`                        |       ❌       |        ✅         | Worker 注册 ai-usage-log / agent-ai-txn / touch 等 handler   |
| `initEventBus()`                               |       ✅       |        ✅         | API publish 事件，Worker subscribe 触发 webhook/notification |
| `initLiteLLMPricingJob()`                      |       ❌       |        ✅         | setInterval 6h，仅 Worker                                    |
| `initTopupExpiryJob()`                         |       ❌       |        ✅         | setInterval 10min，仅 Worker                                 |
| `initWebhookRetryJob()`                        |       ❌       |        ✅         | setInterval 10s，仅 Worker                                   |
| `initDepositScanQueue({ startWorker: false })` |       ✅       |         —         | API 只建 Queue（`enqueueDepositScan` 需要）                  |
| `initDepositScanQueue()`                       |       —        |        ✅         | Worker 建 Queue + Worker 消费                                |
| `initSupplierHealthCheckJob()`                 |       ❌       |        ✅         | BullMQ repeatable + Worker                                   |
| `initLimitedFreeModelExpiryJob()`              |       ❌       |        ✅         | BullMQ repeatable + Worker                                   |

**关键拆分点**：

1. **`initAiRelay()` 必须拆分** — 当前它同时注册 provider adapters（API 路由需要）和 write handlers（Worker 消费需要）。拆成 `initAiAdapters()` + `initAiWriteHandlers()`。

2. **`initDepositScanQueue()` 需要 Queue-only 模式** — API 侧 `enqueueDepositScan()`（`src/server/user/routes/wallet.ts:228` 充值下单时调用）需要 Queue 存在才能 `queue.add()`。两种方案见下文 §4。

3. **3 个 setInterval 任务严格禁止出现在 `bootstrapApi()`** — `expire-topup-orders` / `refresh-litellm-pricing` / `retry-webhook-deliveries` 是纯进程内定时器，多实例会重复执行。API 进程不能启动它们。

### 3. RedisJobQueue Queue-only 模式

**问题**：`src/server/queue/redis-job-queue.ts:31` 构造函数总是同时创建 `new Queue` + `new Worker`。API 进程只需要 Queue 来 enqueue，不需要 Worker 来竞争消费。

**改动**：构造函数增加 `startWorker` 选项（默认 `true`，向后兼容）：

```typescript
// src/server/queue/redis-job-queue.ts
constructor(
  label: string,
  maxDepth: number,
  connection: ConnectionOptions,
  options?: { startWorker?: boolean },  // 新增
) {
  this.queue = new Queue(label, { connection, defaultJobOptions: { ... } });
  if (options?.startWorker !== false) {
    this.worker = new Worker(label, this.processJob.bind(this), {
      connection,
      concurrency: 5,
    });
  }
}
```

透传链路：

- `src/server/queue/index.ts` → `createJobQueue(name, maxDepth, options?)` 透传 `startWorker`
- `src/server/lib/write-queue.ts` → `initWriteQueue(options?)` 透传
- `src/server/jobs/scan-topup-deposit.ts` → `initDepositScanQueue(options?)` 透传

**为什么不直接让两进程都跑 Worker？** BullMQ 多 Worker 竞争消费功能上 OK（job 会被分布式锁保证只被一个 Worker 处理），但：

- 违背分离初衷（API 进程仍扛消费负载）
- API 进程多一份 Redis 连接（Worker 连接）
- API 进程 crash 时正在处理的 job 会重投，徒增重试开销

### 4. `enqueueDepositScan` 在 API 侧的方案

`enqueueDepositScan()`（`src/server/jobs/scan-topup-deposit.ts:219`）直接调用 `queue.add("scan", ...)`，不走通用 write-queue。API 侧充值下单时调用它，因此 API 进程必须有 Queue 实例。

**方案 A（推荐）**：API 侧调 `initDepositScanQueue({ startWorker: false })`，只建 Queue 不建 Worker。

- 优点：代码改动最小，`enqueueDepositScan` 行为不变
- 缺点：API 进程多一个 Queue 连接（轻量）

**方案 B**：把 `enqueueDepositScan` 改造为走通用 write-queue（`enqueueJob("deposit-scan", ...)`），Worker 侧注册对应 handler。

- 优点：架构更统一，所有 enqueue 走一个通道
- 缺点：改动大，`scan-topup-deposit.ts` 的自重调度逻辑（延迟重试）需要适配 write-queue 的 batch / handler 模型

**本次采用方案 A**。方案 B 留作后续优化。

### 5. 新建 `src/server/worker.ts`

Worker 进程入口，对应 `src/server/index.ts` 的结构，但去掉所有 HTTP 相关逻辑：

```typescript
import { closeCacheStores } from "@/server/cache";
import { closeDb } from "@/server/db";
import { closeEventBus } from "@/server/events";
import { closeSupplierHealthCheckJob } from "@/server/jobs/check-supplier-health";
import { closeLimitedFreeModelExpiryJob } from "@/server/jobs/expire-limited-free-models";
import { stopTopupExpiryJob } from "@/server/jobs/expire-topup-orders";
import { stopLiteLLMPricingJob } from "@/server/jobs/refresh-litellm-pricing";
import { closeDepositScanQueue } from "@/server/jobs/scan-topup-deposit";
import { bootstrapWorker } from "@/server/lib/bootstrap";
import { log, logger } from "@/server/lib/logger";
import { closeRedis } from "@/server/lib/redis";
import { closeWriteQueue, flushWriteQueue } from "@/server/lib/write-queue";
import { stopWebhookRetryJob } from "@/server/messaging/jobs/retry-webhook-deliveries";

async function main() {
  await bootstrapWorker();
  log.bootstrap.info("Worker process ready");
}

main().catch((err) => {
  logger.fatal({ err }, "Worker bootstrap failed");
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.shutdown.info({ signal }, "Worker shutting down");

  // 1. 停 setInterval 定时器
  stopTopupExpiryJob();
  stopLiteLLMPricingJob();
  stopWebhookRetryJob();

  // 2. 关 BullMQ Worker（会等待 in-flight job 完成）
  await closeDepositScanQueue();
  await closeSupplierHealthCheckJob();
  await closeLimitedFreeModelExpiryJob();

  // 3. flush write-queue 剩余 job（best-effort）
  const flushed = await flushWriteQueue(1000);
  log.shutdown.info({ flushed }, "Flushed pending writes");
  await closeWriteQueue();

  // 4. 关 event bus / cache / redis / db
  await Promise.allSettled([closeEventBus(), closeCacheStores()]);
  await closeRedis();
  await closeDb();

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
```

### 6. `src/server/env.ts` — PORT 改为可选

**问题**：当前 `PORT` 对所有环境 required（`z.coerce.number().int().positive()`）。Worker 进程不绑定端口。

**改动**：

```typescript
PORT: z.coerce.number().int().positive().optional(),
```

`src/server/index.ts` 侧加校验：

```typescript
if (env.PORT == null) {
  throw new Error("PORT is required for API process");
}
```

Worker 进程不需要 PORT。

### 7. `tsup.config.ts` — 增加第二个 entry

```typescript
export default defineConfig({
  entry: ["src/server/index.ts", "src/server/worker.ts"], // 新增 worker.ts
  outDir: "dist/server",
  // ... 其余不变
});
```

输出 `dist/server/index.js` + `dist/server/worker.js`。

### 8. `package.json` — 新增 scripts

```json
{
  "scripts": {
    "start": "node dist/server/index.js",
    "start:worker": "node dist/server/worker.js",
    "dev:worker": "tsx watch --env-file=.env.local src/server/worker.ts"
  },
  "packageManager": "pnpm@10.32.1"
}
```

**`packageManager` 字段**：当前缺失。CI 用 `pnpm@9`，Dockerfile pin `pnpm@10.32.1`，Railway Railpack 自动检测。加上消除版本漂移。

### 9. `src/server/index.ts` — 改用 `bootstrapApi()`

- Line 134：`await bootstrap()` → `await bootstrapApi()`
- Shutdown 函数（line 184-216）：去掉所有 worker-only 的 stop/close 调用（`stopTopupExpiryJob` / `closeDepositScanQueue` / `closeSupplierHealthCheckJob` / `closeLimitedFreeModelExpiryJob` / `stopLiteLLMPricingJob` / `stopWebhookRetryJob`），因为 API 进程不再启动它们

### 10. 本地 dev 兼容

保持 `pnpm dev` 单进程跑全部（向后兼容现有开发习惯）：

- 保留 `bootstrap()` 函数（= `bootstrapApi()` + `bootstrapWorker()` 的合集）
- `src/server/index.ts` 在 dev 模式下调 `bootstrap()`，生产下调 `bootstrapApi()`

```typescript
// src/server/index.ts line 134
if (process.env.NODE_ENV === "development" && !process.env.SPLIT_WORKER) {
  await bootstrap(); // dev: 单进程跑全部
} else {
  await bootstrapApi(); // prod: 只跑 API
}
```

或更简单：加一个 `ROLE` env：

| `ROLE`            | API 进程行为       | Worker 进程行为     |
| ----------------- | ------------------ | ------------------- |
| `all`（默认 dev） | `bootstrap()` 全部 | —                   |
| `api`             | `bootstrapApi()`   | —                   |
| `worker`          | —                  | `bootstrapWorker()` |

本地 `pnpm dev` 设 `ROLE=all`；生产 API service 设 `ROLE=api`，worker service 设 `ROLE=worker`。

---

## Railway 部署配置

### 同一 repo，两个 Service

Railway 支持从一个 repo 部署多个 service。推荐用根 `railway.toml` + service 级 override：

**根 `railway.toml`**（保持现状，作为 API 默认）：

```toml
[build]
builder = "RAILPACK"
buildCommand = "pnpm build"
watchPatterns = ["src/**", "package.json", "pnpm-lock.yaml"]

[deploy]
startCommand = "pnpm start"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

**Worker service**（Railway dashboard 或 service 级 `railway.toml`）：

```toml
[build]
builder = "RAILPACK"
buildCommand = "pnpm build"
watchPatterns = ["src/**", "package.json", "pnpm-lock.yaml"]

[deploy]
startCommand = "pnpm start:worker"
# Worker 无 HTTP server，不能用 healthcheckPath
healthcheckCommand = "node -e \"require('net').connect(process.env.REDIS_URL.match(/:(\\d+)/)[1], process.env.REDIS_URL.match(/@([^:]+)/)[1]).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))\""
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

> **Healthcheck 待决策**：见下文「待确认问题」§1。

### 环境变量

| 变量                                   | API service | Worker service | 说明                                     |
| -------------------------------------- | :---------: | :------------: | ---------------------------------------- |
| `DATABASE_URL`                         |     ✅      |       ✅       | 引用同一 Postgres service                |
| `REDIS_URL`                            |     ✅      |       ✅       | 引用同一 Redis service                   |
| `JWT_SECRET`                           |     ✅      |   ❌（可选）   | Worker 不签发 JWT                        |
| `ENCRYPTION_KEY`                       |     ✅      |       ✅       | webhook-deliver handler 解密 secret 需要 |
| `ENCRYPTION_SALT`                      |     ✅      |       ✅       | 同上                                     |
| `PORT`                                 |     ✅      |       ❌       | Worker 不绑定                            |
| `DOMAIN`                               |     ✅      |       ❌       | API 专属                                 |
| `NODE_ENV`                             |     ✅      |       ✅       | 都设 `production`                        |
| `ROLE`                                 |    `api`    |    `worker`    | 进程角色（见 §10）                       |
| `SUPPLIER_HEALTH_CHECK_INTERVAL_MS` 等 |     ✅      |       ✅       | Worker 读取，API 不读但无害              |
| `ALCHEMY_API_KEY`                      |     ✅      |       ✅       | blockchain config 需要                   |

---

## 迁移步骤

每步独立可验证、可回滚。建议每步一个 commit。

| 步骤 | 改动                                                                                                          | 验证                                                                                                      |        可回滚         |
| :--: | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | :-------------------: |
|  1   | `redis-job-queue.ts` 加 `startWorker` 选项；`createJobQueue` / `initWriteQueue` / `initDepositScanQueue` 透传 | `pnpm typecheck` + `pnpm test:unit` 通过                                                                  |     ✅ git revert     |
|  2   | `initAiRelay()` 拆分为 `initAiAdapters()` + `initAiWriteHandlers()`                                           | `pnpm dev` 全功能跑通（此时仍用 `bootstrap()`）                                                           |          ✅           |
|  3   | `bootstrap.ts` 拆 `bootstrapApi()` + `bootstrapWorker()`，保留 `bootstrap()` 作为合集                         | `pnpm dev`（`ROLE=all`）全功能跑通                                                                        |          ✅           |
|  4   | `env.ts` PORT 改 optional；`index.ts` 加 PORT 校验                                                            | `pnpm typecheck`                                                                                          |          ✅           |
|  5   | 新建 `src/server/worker.ts` + shutdown 逻辑                                                                   | 本地 `pnpm dev:worker` 跑通，观察日志消费 job                                                             |          ✅           |
|  6   | `index.ts` 接入 `ROLE`（`api` → `bootstrapApi()`，`all` → `bootstrap()`）                                     | 本地 `ROLE=api pnpm dev` + `pnpm dev:worker` 双开跑通，全功能验证                                         |          ✅           |
|  7   | `tsup.config.ts` 加 entry；`package.json` 加 `start:worker` / `dev:worker` + pin `packageManager`             | `pnpm build` 产出 `dist/server/index.js` + `dist/server/worker.js`，`node dist/server/worker.js` 启动成功 |          ✅           |
|  8   | Railway 创建 worker service，配 startCommand + healthcheck + env                                              | Worker service deploy 成功，日志显示消费 job；API service 日志不再有 worker 启动行                        |     ✅ 删 service     |
|  9   | Railway API service 确认 `ROLE=api` 生效                                                                      | API 日志无 worker 启动行；网关请求正常；充值下单 → worker 消费 deposit-scan 正常                          | ✅ redeploy 旧 commit |

**第 6 步是关键验证点**：本地 `ROLE=api` + `dev:worker` 双开跑通 = 生产可分。

---

## 风险与回退

| 风险                                                      | 影响                         | 缓解                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 漏拆某个 setInterval 到 `bootstrapApi()` → 双进程重复执行 | 重复扣费 / 重复 webhook 发送 | 第 3 步 code review `bootstrapApi()` 不含任何 setInterval 初始化；`expire-topup-orders` / `refresh-litellm-pricing` / `retry-webhook-deliveries` 三个 init 只在 `bootstrapWorker()` |
| `enqueueJob` 在 API 侧 Queue 未初始化 → 静默丢弃 job      | 计费 / 日志丢失              | `initWriteQueue({ startWorker: false })` 在 `bootstrapApi()` 早期调用；`enqueueJob` 已有 throttled warning 日志，监控该日志                                                         |
| `enqueueDepositScan` 在 API 侧无 Queue → 报错             | 充值下单失败                 | 第 1 步 `initDepositScanQueue({ startWorker: false })` 在 `bootstrapApi()` 中调用                                                                                                   |
| Worker 挂了 API 不感知 → job 积压                         | 队列堆积，计费/日志延迟      | Railway `restartPolicyType = "ON_FAILURE"`；后续可加 BullMQ `getJobCounts()` 监控告警                                                                                               |
| 本地 dev 习惯单进程 → 麻烦                                | 开发体验下降                 | 保留 `ROLE=all` / `pnpm dev` 单进程模式（§10），只有生产分进程                                                                                                                      |
| `bootstrapApi()` 漏了 event bus → API 无法 publish 事件   | webhook/notification 不触发  | event bus publish 是 API 侧必需（供应商禁用、充值确认等事件由 API 触发），`bootstrapApi()` 包含 `initEventBus()`                                                                    |
| tsup 多 entry 导致 bundle 体积变化                        | 构建失败 / 产物异常          | 第 7 步验证 `pnpm build` 产出两个独立 bundle，`node dist/server/worker.js` 启动成功                                                                                                 |

**回退方案**：

1. **代码层面**：所有改动在 git 里。`bootstrapApi()` / `bootstrapWorker()` 不存在时，`index.ts` fallback 到 `bootstrap()`（加兼容判断）
2. **Railway 层面**：删 worker service + API service redeploy 旧 commit（`ROLE=all` 或无 ROLE 逻辑的版本）→ 恢复单进程
3. **数据层面**：无 DB schema 变更，无数据迁移，无需回滚数据

---

## 待确认问题

在开始实现前，需要拍板 3 个设计决策：

### 1. Worker healthcheck 方案

Worker 进程无 HTTP server，Railway 的 `healthcheckPath` 不适用。选项：

- **方案 A（推荐）**：Worker 也起一个极简 HTTP server（仅 `GET /health` 返回 200，不注册任何业务路由）——Railway healthcheck 配置与 API 一致，最省事
- **方案 B**：用 Railway `healthcheckCommand` 跑 shell 检查（如 `redis-cli -u $REDIS_URL ping` + `pg_isready $DATABASE_URL`）——更纯粹但配置复杂，且只检查依赖连通性不检查进程健康
- **方案 C**：不配 healthcheck，仅靠 Railway restart policy——风险是进程卡死（不 crash）时不重启

### 2. 本地 dev 模式

- **方案 A（推荐）**：保持 `pnpm dev` 单进程跑全部（`ROLE=all`），与生产不一致但开发体验好
- **方案 B**：改成 `pnpm dev:api` + `pnpm dev:worker` 双开，与生产一致但需要两个终端
- **方案 C**：`pnpm dev` 用 concurrently 同时拉起 api + worker 两个进程（兼顾一致性和便利，但日志会混）

### 3. `enqueueDepositScan` 在 API 侧

- **方案 A（推荐）**：API 侧调 `initDepositScanQueue({ startWorker: false })`，只建 Queue——改动最小
- **方案 B**：`enqueueDepositScan` 改走通用 write-queue（`enqueueJob("deposit-scan", ...)`）——架构更统一但改动大，且需适配 scan-topup-deposit 的延迟重试逻辑

---

## 附录：当前代码库任务清单（探索结果）

### BullMQ Queue + Worker 实例（4 个）

| 文件                                                  | Queue 名                    | Worker 并发 | 调度方式               | 多实例安全 |
| ----------------------------------------------------- | --------------------------- | ----------- | ---------------------- | :--------: |
| `src/server/queue/redis-job-queue.ts:35,46`           | `write-queue`               | 5           | 按需 enqueue           |     ✅     |
| `src/server/jobs/scan-topup-deposit.ts:239,248`       | `deposit-scan`              | 3           | 按需 + 延迟重试        |     ✅     |
| `src/server/jobs/check-supplier-health.ts:364,385`    | `supplier-health-check`     | 1           | BullMQ repeatable 60s  |     ✅     |
| `src/server/jobs/expire-limited-free-models.ts:55,75` | `limited-free-model-expiry` | 1           | BullMQ repeatable 5min |     ✅     |

### setInterval 定时任务（3 个，非多实例安全）

| 文件                                                       | 间隔   | 职责                  |
| ---------------------------------------------------------- | ------ | --------------------- |
| `src/server/jobs/expire-topup-orders.ts:45`                | 10 min | 过期未支付充值单      |
| `src/server/jobs/refresh-litellm-pricing.ts:112`           | 6h     | 刷新 LiteLLM 模型定价 |
| `src/server/messaging/jobs/retry-webhook-deliveries.ts:45` | 10s    | 扫描待重试 webhook    |

### enqueueJob 调用点（API 侧 producer）

| 文件:行                                                    | Job 名                 | 上下文                         |
| ---------------------------------------------------------- | ---------------------- | ------------------------------ |
| `src/server/ai/lib/billing.ts:241`                         | `agent-ai-txn`         | 计费交易 + 分润                |
| `src/server/ai/lib/billing.ts:279`                         | `ai-usage-log`         | 用量日志                       |
| `src/server/ai/lib/billing.ts:301`                         | `consumer-key-touch`   | 更新 consumer key last_used_at |
| `src/server/ai/lib/billing.ts:302`                         | `ai-key-touch`         | 更新上游 key last_used_at      |
| `src/server/ai/lib/billing.ts:306`                         | `ai-request-log`       | 请求/响应体日志                |
| `src/server/ai/routes/relay.ts:346,602`                    | `ai-usage-log`         | Admin relay                    |
| `src/server/ai/routes/relay.ts:366,624`                    | `ai-request-log`       | Admin relay                    |
| `src/server/ai/routes/relay.ts:376,633`                    | `ai-key-touch`         | Admin relay                    |
| `src/server/ai/lib/access-log.ts:37`                       | `ai-usage-log`         | Access log helper              |
| `src/server/ai/lib/access-log.ts:59`                       | `ai-request-log`       | Access log helper              |
| `src/server/ai/lib/stream-proxy.ts:501,755`                | `ai-key-touch`         | 流式代理                       |
| `src/server/ai/lib/stream-proxy.ts:984`                    | `ai-usage-log`         | 流式代理                       |
| `src/server/middleware/auth-strategies/api-key.ts:24`      | `api-key-touch`        | API key 鉴权                   |
| `src/server/messaging/notifications/dispatcher.ts:111`     | `notification-deliver` | 通知派发                       |
| `src/server/messaging/notifications/dispatcher.ts:170`     | `notification-deliver` | 限流重试                       |
| `src/server/messaging/jobs/retry-webhook-deliveries.ts:29` | `webhook-deliver`      | 定时重试扫描                   |
| `src/server/events/consumers/webhook.ts:48`                | `webhook-deliver`      | 事件总线触发                   |

**全部在 API 进程（routes / middleware / billing / stream-proxy）**。Worker 进程只消费，不调用 `enqueueJob`。

### Redis 连接

- **共享 singleton**：`src/server/lib/redis.ts:24` — `getRedis()` / `initRedis()` / `closeRedis()`，用于 cache / rate-limit / event bus
- **BullMQ 独立连接**：每个 Queue / Worker 各自创建 `connection = { url: process.env.REDIS_URL }`，不走 singleton

**分离后**：API 和 Worker 各自独立的 Redis 连接集，无共享 in-process state。两者只需 `REDIS_URL` 指向同一 Redis。
