# RFC: 供应商状态自动维护（健康检查 + 自动禁用/恢复）

- **Status**: Draft v1
- **Date**: 2026-06-22
- **Author**: Starriv + Sisyphus
- **Related**: `docs/rfcs/rfc-proxy-pool.md`（独立但相关，均涉及上游可用性）

## Problem

当前 `ai_endpoints` 和 `ai_upstreams` 只有 `enabled` 布尔字段，无法反映真实联通状况。问题：

1. **静默故障** — 上游 API 挂了/密钥失效/网络不通，系统不知道，请求继续路由过去 → 5xx 雪崩
2. **无自动恢复** — 即使上游临时挂了自己恢复，管理员也只能手动重新启用
3. **无法区分故障来源** — `enabled=false` 既可能是管理员手动禁用，也可能是历史上的故障标记，语义混乱
4. **多实例下 setInterval 竞态** — 现有周期任务用 `setInterval`，多实例部署会在每个实例上重复执行，状态变更类操作存在竞态风险

### 现有代码库的 3 套任务模式

| 模式                                     | 代表文件                                                                                                       | 适用场景                                    | 多实例安全  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------- |
| A. `setInterval` 周期任务                | `jobs/refresh-litellm-pricing.ts`、`jobs/expire-topup-orders.ts`、`messaging/jobs/retry-webhook-deliveries.ts` | 只读巡检、幂等清理                          | ❌ 重复执行 |
| B. BullMQ Queue + Worker（带延迟重调度） | `jobs/scan-topup-deposit.ts`                                                                                   | 按需触发 + 延迟重试                         | ✅          |
| C. 通用 RedisJobQueue（异步写入）        | `queue/redis-job-queue.ts`                                                                                     | 请求路径 fire-and-forget 写入（计费、日志） | ✅          |

**模式 C 不适合周期任务**（未暴露 `repeat` API）。供应商状态检查会**修改用户可见状态**（启用/禁用），`setInterval`（模式 A）在多实例下不安全，因此选用 **BullMQ repeatable job（模式 B 的扩展）**。

## Core Insight

> **状态变更类周期任务必须走 BullMQ repeatable job，不能用 `setInterval`。**

BullMQ 的 repeatable job 由 Redis 分布式锁保证同一时刻只有一个 worker 处理，跨实例安全。

## Goals

- 每 1 分钟自动检查所有 enabled 供应商（provider + 其绑定的所有 upstreams）的联通性
- 连续 1 次失败即自动禁用并通知，1 次成功立即恢复
- 区分"管理员手动禁用"和"系统自动禁用" — 双字段分离
- 复用现有 `buildProviderAuth` + `/v1/models` 连通性检测逻辑（已存在于 `admin-ai-models.ts#discover-models`）
- 路由层零行为变化（通过 `enabled && !autoDisabled` 组合判断"有效启用"）
- 多实例部署安全

## Non-Goals

- 不做主动流量探针（不发真实 chat completion 请求，只 ping `/v1/models` 等元数据端点）
- 不做 per-upstream 级别的精细健康聚合（v1 只做 provider 级 + upstream 级独立判定）
- 不做历史健康趋势记录（v1 只保留最新状态）
- 不替换现有 `setInterval` 周期任务（`refresh-litellm-pricing` 等保持现状，未来可统一迁移，不在本次范围）

---

## Design

### 1. 状态模型：双字段分离

引入 `autoDisabled` 字段，与现有 `enabled` 字段组合表达完整状态：

| `enabled` | `autoDisabled` | 含义                         | 路由层是否可用 |
| --------- | -------------- | ---------------------------- | -------------- |
| `true`    | `false`        | 正常启用                     | ✅             |
| `true`    | `true`         | 系统自动禁用（健康检查失败） | ❌             |
| `false`   | `false`        | 管理员手动禁用               | ❌             |
| `false`   | `true`         | （不应出现，迁移期过渡态）   | ❌             |

**有效启用 = `enabled && !autoDisabled`**。

**关键语义**：

- 健康检查只动 `autoDisabled`，**永不触碰 `enabled`**
- 健康检查**跳过 `enabled=false && autoDisabled=false`**（管理员手动禁用）的记录 — 不打扰、不自动恢复
- 管理员手动禁用的记录不会被系统自动恢复

### 2. Schema 变更

给 `ai_endpoints` 和 `ai_upstreams` 表都新增以下列：

```sql
ALTER TABLE ai_endpoints
  ADD COLUMN health_status          TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN last_checked_at        TIMESTAMPTZ,
  ADD COLUMN last_success_at        TIMESTAMPTZ,
  ADD COLUMN last_failure_at        TIMESTAMPTZ,
  ADD COLUMN last_error             TEXT,
  ADD COLUMN consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN auto_disabled          BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ai_upstreams
  ADD COLUMN health_status          TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN last_checked_at        TIMESTAMPTZ,
  ADD COLUMN last_success_at        TIMESTAMPTZ,
  ADD COLUMN last_failure_at        TIMESTAMPTZ,
  ADD COLUMN last_error             TEXT,
  ADD COLUMN consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN auto_disabled          BOOLEAN NOT NULL DEFAULT false;
```

**字段说明**：

| 字段                   | 类型        | 说明                                                   |
| ---------------------- | ----------- | ------------------------------------------------------ |
| `health_status`        | text        | `"unknown"` \| `"healthy"` \| `"degraded"` \| `"down"` |
| `last_checked_at`      | timestamptz | 最后一次检查时间（无论成功失败）                       |
| `last_success_at`      | timestamptz | 最后一次成功时间                                       |
| `last_failure_at`      | timestamptz | 最后一次失败时间                                       |
| `last_error`           | text        | 最后一次失败的错误信息（截断到 1000 字符）             |
| `consecutive_failures` | integer     | 连续失败次数（成功时归零）                             |
| `auto_disabled`        | boolean     | 系统自动禁用标志                                       |

**`health_status` 状态机**：

```
                   ┌──────────┐
        ┌─────────▶│ unknown  │◀─ 初始状态
        │          └──────────┘
        │                │
        │         check │
        │                ▼
        │          ┌──────────┐
        │  success │ healthy  │
        │◀─────────┤          │
        │          └──────────┘
        │                │
        │      1-2 fails │
        │                ▼
        │          ┌──────────┐
        │  success │ degraded │
        │◀─────────┤          │
        │          └──────────┘
        │                │
        │     3+ fails   │
        │                ▼
        │          ┌──────────┐
        │  success │  down    │── auto_disabled=true
        │◀─────────┤          │
        │          └──────────┘
        │                │
        └────────────────┘  (success 任意状态 → healthy)
```

### 3. 模块结构

```
src/server/ai/lib/
  supplier-health.ts          # 新增: 共享连通性检测逻辑
                                #   - buildModelsUrl(provider, baseUrl, override?)
                                #   - pingEndpoint({ provider, baseUrl, override, plainKey, timeoutMs })

src/server/jobs/
  check-supplier-health.ts    # 新增: BullMQ Queue + Worker
                                #   - initSupplierHealthCheckJob()
                                #   - closeSupplierHealthCheckJob()

src/server/repos/
  ai-provider-repo.ts         # 修改: 新增健康相关方法
  ai-upstream-repo.ts         # 修改: 新增健康相关方法

src/server/db/schemas/
  pg.ts                       # 修改: 新增字段定义

src/server/lib/
  logger.ts                   # 修改: 新增 log.supplier 命名空间
  bootstrap.ts                # 修改: 接入 init
  (index.ts at server root)   # 修改: 接入 shutdown

src/server/ai/lib/
  upstream-routing.ts         # 修改: 过滤 !autoDisabled
  (其他检查 enabled=true 处)   # 修改: 全量审计追加 !autoDisabled

src/server/ai/routes/
  admin-ai-models.ts          # 修改: discover-models 复用 supplier-health.ts (去重)

.env.example                  # 修改: 新增 3 个环境变量
```

### 4. 共享连通性检测逻辑

**`src/server/ai/lib/supplier-health.ts`** 抽取自 `admin-ai-models.ts#discover-models`（L100-L125），让 admin 路由和定时任务共享。

```ts
export interface PingResult {
  ok: boolean;
  status: number;
  error?: string;
  latencyMs: number;
}

/**
 * 根据供应商 apiFormat 构造 /models 端点 URL。
 * 抽取自 admin-ai-models.ts#L100-L110。
 */
export function buildModelsUrl(
  provider: Pick<AiProvider, "apiFormat">,
  baseUrl: string,
  modelsEndpointOverride?: string | null,
): string;

/**
 * Ping 供应商端点，返回连通性结果。
 * 内部调用 buildProviderAuth + fetch(AbortSignal.timeout)。
 */
export async function pingEndpoint(opts: {
  provider: Pick<AiProvider, "authType" | "authConfig" | "apiFormat">;
  baseUrl: string;
  modelsEndpointOverride?: string | null;
  plainKey: string;
  timeoutMs?: number; // 默认 10000
}): Promise<PingResult>;
```

**各 apiFormat 的 models URL 构造规则**（复用现有逻辑）：

| apiFormat                 | URL 构造                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `openai` / `azure-openai` | `baseUrl` 末尾去 `/`，若已 `/v1` 则 `+ /models`，否则 `+ /v1/models`                                                |
| `anthropic`               | `baseUrl + /models`；若返回 400/404/405 且未配置自定义 models endpoint，则 fallback 到最小 `POST /v1/messages` 探测 |
| `gemini`                  | `baseUrl + /models`                                                                                                 |
| `bedrock`                 | 将 `bedrock-runtime.` 替换为 `bedrock.`，`+ /foundation-models`                                                     |

### 5. Job 文件设计

**`src/server/jobs/check-supplier-health.ts`** 参考 `scan-topup-deposit.ts` 的 Queue+Worker 模式：

```ts
const QUEUE_NAME = "supplier-health-check";
const CHECK_INTERVAL_MS = 60 * 1000; // 1 分钟（可通过 env 覆盖）
const FAILURE_THRESHOLD = 2; // 失败窗口内累计 2 次后自动禁用并通知
const FAILURE_WINDOW_MS = 3 * 60 * 1000; // 3 分钟失败计数窗口
const REQUEST_TIMEOUT_MS = 10_000; // 10s 超时
const WORKER_CONCURRENCY = 5; // 同时最多检查 5 个 endpoint

let queue: Queue | null = null;
let worker: Worker | null = null;
let repeatableJobId: string | null = null;

export async function initSupplierHealthCheckJob(): Promise<void>;
export async function closeSupplierHealthCheckJob(): Promise<void>;
```

**`init` 流程**：

```ts
async function initSupplierHealthCheckJob() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.supplier.warn("REDIS_URL not set — supplier health check disabled");
    return;
  }

  const connection = { url: redisUrl };

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1, // 不自动重试 — 失败等下次 tick
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });

  // 注册 repeatable job — 多实例下 jobId 保证只有一个调度
  await queue.add(
    "check-all",
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: "supplier-health-check-recurring",
    },
  );

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await checkAllSuppliers();
    },
    { connection, concurrency: 1 }, // 串行处理 check-all tick
  );

  worker.on("failed", (job, err) => {
    log.supplier.error({ err }, "Supplier health check job failed");
  });

  log.supplier.info(
    { intervalMs: CHECK_INTERVAL_MS, failureThreshold: FAILURE_THRESHOLD },
    "Supplier health check job started",
  );
}
```

**`checkAllSuppliers` 主逻辑**：

```ts
async function checkAllSuppliers() {
  const providers = await aiEndpointRepo.findAllEnabled();

  // 限制并发: 最多 5 个 provider 同时检查
  await runWithConcurrency(providers, 5, async (provider) => {
    // 1. 跳过管理员手动禁用
    if (!provider.enabled && !provider.autoDisabled) {
      return; // admin-disabled — 不打扰、不恢复
    }

    // 2. 取 provider 的 API key
    const key = await aiKeyRepo.findAnyEnabledByProvider(provider.id);
    if (!key) {
      await aiEndpointRepo.recordFailure(provider.id, "No enabled API key");
      // 无 key 不计入禁用阈值，仅标记 degraded
      return;
    }

    const plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);

    // 3. Ping provider.baseUrl
    const providerResult = await pingEndpoint({
      provider,
      baseUrl: provider.baseUrl,
      plainKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    // 4. Ping 所有绑定的 enabled + !autoDisabled upstreams
    const assignments = await aiUpstreamAssignmentRepo.findByProviderId(provider.id);
    const upstreams = (await aiUpstreamRepo.findByIds(assignments.map((a) => a.upstreamId))).filter(
      (u) => u.enabled && !u.autoDisabled,
    );

    const upstreamResults = await Promise.all(
      upstreams.map((u) =>
        pingEndpoint({
          provider,
          baseUrl: u.baseUrl,
          modelsEndpointOverride: u.modelsEndpoint,
          plainKey,
          timeoutMs: REQUEST_TIMEOUT_MS,
        }).then((r) => ({ upstream: u, result: r })),
      ),
    );

    // 5. 更新 provider 状态
    await applyHealthResult(aiEndpointRepo, provider, providerResult);

    // 6. 更新每个 upstream 状态
    for (const { upstream, result } of upstreamResults) {
      await applyHealthResult(aiUpstreamRepo, upstream, result);
    }
  });
}

async function applyHealthResult(repo, entity, result: PingResult) {
  if (result.ok) {
    // 成功 — 若 autoDisabled=true 则恢复
    if (entity.autoDisabled) {
      await repo.markAutoReenabled(entity.id);
      await emitNotification("supplier.reenabled", {
        title: `供应商已自动恢复: ${entity.name}`,
        body: `...`,
        metadata: { id: entity.id, name: entity.name },
      });
    } else {
      await repo.recordSuccess(entity.id);
    }
  } else {
    // 失败 — 超出失败窗口则先重置计数，再累加失败计数
    if (isFailureWindowExpired(entity)) {
      await repo.updateHealth(entity.id, { consecutiveFailures: 0 });
    }
    await repo.recordFailure(entity.id, result.error ?? `HTTP ${result.status}`);

    // 检查是否达到禁用阈值
    const updated = await repo.findById(entity.id);
    if (updated && updated.consecutiveFailures >= FAILURE_THRESHOLD && !updated.autoDisabled) {
      await repo.markAutoDisabled(entity.id, updated.lastError ?? "Unknown error");
      await emitNotification("supplier.disabled", {
        title: `供应商已自动禁用: ${entity.name}`,
        body: `3 分钟内累计 ${FAILURE_THRESHOLD} 次连通性检查失败，已自动禁用。最后错误: ${updated.lastError}`,
        metadata: { id: entity.id, name: entity.name, error: updated.lastError },
      });
    }
  }
}
```

### 6. 仓库层新增方法

**`ai-provider-repo.ts` + `ai-upstream-repo.ts` 镜像新增**：

```ts
async findAllActive(): Promise<AiProvider[]> {
  // enabled=true && autoDisabled=false — 供路由层使用
  return queryAll(
    db.select().from(aiEndpoints)
      .where(and(eq(aiEndpoints.enabled, true), eq(aiEndpoints.autoDisabled, false)))
      .orderBy(asc(aiEndpoints.id)),
  );
},

async updateHealth(
  id: number,
  patch: {
    healthStatus?: "unknown" | "healthy" | "degraded" | "down";
    lastCheckedAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    lastError?: string | null;
    consecutiveFailures?: number;
  },
): Promise<void>

async recordSuccess(id: number): Promise<void> {
  // consecutiveFailures=0, healthStatus="healthy", lastSuccessAt=now, lastCheckedAt=now
}

async recordFailure(id: number, error: string): Promise<void> {
  // consecutiveFailures++, lastFailureAt=now, lastError=truncate(error, 1000),
  // healthStatus = consecutiveFailures >= threshold ? "down" : "degraded",
  // lastCheckedAt=now
  // 注意: threshold 由调用方判断，repo 只负责计数和状态机
}

async markAutoDisabled(id: number, reason: string): Promise<void> {
  // autoDisabled=true, healthStatus="down"; do not change enabled
}

async markAutoReenabled(id: number): Promise<void> {
  // autoDisabled=false, healthStatus="healthy", consecutiveFailures=0; do not change enabled
}
```

### 7. 路由层 `!autoDisabled` 审计

需要全量 grep 审计所有检查 `enabled=true` 的位置，追加 `&& !autoDisabled`（或改用 `findAllActive()`）：

**已识别的关键位置**：

- `src/server/ai/lib/upstream-routing.ts` — `resolveUpstreamCandidates()` 过滤 enabled upstreams
- `src/server/jobs/refresh-litellm-pricing.ts#L47` — `eq(aiEndpoints.enabled, true)` 改为 `and(eq(enabled, true), eq(autoDisabled, false))`
- `src/server/ai/lib/key-balancer.ts` — 若有 provider 启用检查
- 其他 admin/dashboard/计费路径中 `eq(aiEndpoints.enabled, true)` / `eq(aiUpstreams.enabled, true)` 出现处

**审计例外**：

- Admin 管理界面应展示所有记录（包括 auto-disabled），并在 UI 上区分"自动禁用"和"手动禁用"
- 健康检查任务自身用 `findAllForHealthCheck()`（返回 `enabled=true OR autoDisabled=true`，跳过管理员手动禁用且未自动禁用的记录）

### 8. 通知事件

复用现有 `emitNotification` 系统：

| 事件                 | 触发时机                     | 标题                       | 元数据                |
| -------------------- | ---------------------------- | -------------------------- | --------------------- |
| `supplier.disabled`  | 失败窗口内累计达阈值时       | `供应商已自动禁用: {name}` | `{ id, name, error }` |
| `supplier.reenabled` | auto-disabled 状态下首次成功 | `供应商已自动恢复: {name}` | `{ id, name }`        |

### 9. 环境变量

```env
# ── Supplier Health Check ──
# SUPPLIER_HEALTH_CHECK_INTERVAL_MS=60000        # 检查间隔，默认 1 分钟
# SUPPLIER_HEALTH_CHECK_FAILURE_THRESHOLD=2      # 失败窗口内累计 N 次失败后自动禁用
# SUPPLIER_HEALTH_CHECK_FAILURE_WINDOW_MS=180000 # 失败计数窗口，默认 3 分钟
# SUPPLIER_HEALTH_CHECK_TIMEOUT_MS=10000         # 单次 ping 超时
```

**测试加速**：端到端验证时可设 `SUPPLIER_HEALTH_CHECK_INTERVAL_MS=30000`（30s）进一步加速。

### 10. 可观测性

| 信号         | 级别  | 内容                                                                      |
| ------------ | ----- | ------------------------------------------------------------------------- |
| Job 启动     | info  | `{ intervalMs, failureThreshold, timeoutMs }`                             |
| 单次检查开始 | debug | `{ providerId, baseUrl }`                                                 |
| 检查成功     | debug | `{ providerId, latencyMs }`                                               |
| 检查失败     | warn  | `{ providerId, status, error, consecutiveFailures }`                      |
| 自动禁用     | error | `{ providerId, name, consecutiveFailures, lastError }` + emitNotification |
| 自动恢复     | info  | `{ providerId, name }` + emitNotification                                 |
| 无 API key   | warn  | `{ providerId }` (跳过，标记 degraded)                                    |

### 11. Logger 命名空间

在 `src/server/lib/logger.ts` 新增 `supplier` 子 logger，遵循现有命名规范。

---

## Implementation Phases

### Phase 1: 数据库 + 仓库层（3 任务）

1. `ai_endpoints` + `ai_upstreams` 表新增 7 个健康字段
2. 更新 `src/server/db/schemas/pg.ts` 字段定义
3. 生成 Drizzle migration 并验证 SQL（应为 `ALTER TABLE ... ADD COLUMN ...`）
4. `ai-provider-repo.ts` 新增 6 个方法（`findAllActive`、`updateHealth`、`recordSuccess`、`recordFailure`、`markAutoDisabled`、`markAutoReenabled`）
5. `ai-upstream-repo.ts` 镜像同样方法

### Phase 2: 共享健康检测逻辑（2 任务）

6. 新建 `src/server/ai/lib/supplier-health.ts`：`buildModelsUrl()` + `pingEndpoint()`
7. 重构 `admin-ai-models.ts#discover-models` 使用新模块（去重）

### Phase 3: Job 实现（2 任务，核心）

8. 新建 `src/server/jobs/check-supplier-health.ts`：BullMQ Queue + Worker + repeatable job
9. 实现 `checkAllSuppliers()` + `applyHealthResult()` + 通知

### Phase 4: 接入与路由层（4 任务）

10. `bootstrap.ts` 在 `initDepositScanQueue()` 后加 `await initSupplierHealthCheckJob()`
11. `index.ts` shutdown 加 `await closeSupplierHealthCheckJob()`
12. 路由层全量审计 + 追加 `!autoDisabled`（`upstream-routing.ts`、`key-balancer.ts`、`refresh-litellm-pricing.ts` 等）
13. `.env.example` 新增 3 个环境变量

### Phase 5: 收尾验证（4 任务）

14. `logger.ts` 新增 `supplier` 命名空间
15. LSP diagnostics 检查所有改动文件
16. `pnpm typecheck && pnpm build:server` 通过
17. 端到端验证：启动 dev:services → 确认 job 注册 → 模拟 provider 故障验证 auto-disable → 模拟恢复验证 auto-reenable

---

## Alternatives Considered

### A. 使用 `setInterval`（模式 A）

复用 `refresh-litellm-pricing.ts` 的 `setInterval` 模式。

**问题**：多实例部署下每个实例都会重复执行健康检查，状态变更（`markAutoDisabled` / `markAutoReenabled`）存在竞态。虽然可以加 Redis 分布式锁，但 BullMQ 已经内置了这套机制，无需自造。

**适用场景**：只读巡检、幂等清理（现有 `refresh-litellm-pricing` 等保持现状合理）。

### B. 使用通用 `RedisJobQueue`（模式 C）

复用 `queue/redis-job-queue.ts`。

**问题**：该抽象是为请求路径异步写入设计的，没有暴露 `queue.add(name, data, { repeat })` API。要支持 repeatable 需要破坏现有接口契约。

### C. 引入 Agenda / Bree / node-cron

| 库            | Stars | Redis        | 定时任务 | 多实例安全 | 结论                   |
| ------------- | ----- | ------------ | -------- | ---------- | ---------------------- |
| **BullMQ**    | 6.5k  | ✅           | ✅       | ✅         | ✅ **已安装，选它**    |
| Bull (legacy) | 16k   | ✅           | ✅       | ✅         | 已被 BullMQ 取代，弃用 |
| Agenda        | 9k    | ❌ (MongoDB) | ✅       | ✅         | 数据库不匹配           |
| Bree          | 3k    | ❌           | ✅       | ❌         | 进程内，无 Redis       |
| node-cron     | 3k    | ❌           | ✅       | ❌         | 仅 cron，无队列        |
| Temporal      | 12k   | ❌           | ✅       | ✅         | 杀鸡用牛刀（独立服务） |

**BullMQ 是 Redis-backed 任务队列的事实标准**，已经在 `package.json` 中，无需新增依赖。社区主流方案，GitHub 6.5k+ stars，Bull 的官方继任者。

### D. 只检查 provider.baseUrl，不检查 upstreams

**问题**：实际请求走的是 upstreams（第二层路由），provider.baseUrl 只是 fallback。只检查 provider 会漏掉 upstream 级故障。

**本次选择**：Provider + 所有绑定的 enabled + !autoDisabled upstreams 都检查。粒度更细，能精确定位哪个上游挂了。

### E. 立即禁用 vs 窗口阈值禁用

| 策略                      | 优点                         | 缺点                   |
| ------------------------- | ---------------------------- | ---------------------- |
| 1 次（立即禁用）          | 响应最快，首次失败即可告警   | 偶发网络抖动容易误禁用 |
| **3 分钟内 2 次（选用）** | 容忍单次瞬时抖动，响应仍较快 | 真实故障需二次失败确认 |
| 3 次（约 3 分钟）         | 更保守                       | 真实故障需数分钟才禁用 |
| 5 次（约 5 分钟）         | 最保守                       | 真实故障响应慢         |

**选择 3 分钟内 2 次**：默认 1 分钟检查一次，单次网络抖动只标记 degraded，不自动禁用/通知；3 分钟窗口内第二次失败才触发 `supplier.disabled`。

---

## Open Questions

1. **Bedrock SigV4 检查复杂度** — Bedrock provider 的连通性检查需要 SigV4 签名，逻辑较重。`buildProviderAuth` 已支持，但首次失败可能是签名配置错而非真正故障。是否需要对 Bedrock 做特殊处理（如只检查 IAM 配置完整性，不实际发请求）？
2. **通知去重** — 供应商在 flapping（故障-恢复-故障）时会发出大量通知。是否需要通知去重（如 1 小时内同一供应商最多 1 条禁用通知）？
3. **Admin 手动覆盖** — 当 `autoDisabled=true` 时，管理员是否可以手动强制启用（设 `autoDisabled=false` 但保留 `enabled=true`）？若可以，健康检查下次成功前是否应跳过该供应商？
4. **健康检查期间路由层行为** — 健康检查请求（`/v1/models`）本身会消耗上游配额吗？OpenAI/Anthropic 的 `/v1/models` 端点是否计入 rate limit？
5. **跨实例 SWRR 一致性** — Worker 的 SWRR 状态是进程本地的（参考现有 `key-balancer.ts`）。多实例部署时各进程独立轮询，可接受（等价于现有 key-balancer 行为）。但 BullMQ repeatable job 的调度本身是多实例安全的。
6. **历史健康趋势** — v1 只保留最新状态（`last_checked_at`、`last_error` 等）。是否需要记录历史到独立表（`ai_endpoint_health_logs`）供后续做 SLA 分析？本次 RFC 不包含。

---

## Migration Path

### 阶段 1（本次 RFC）：基础健康检查

- Schema 字段 + 仓库方法 + Job + 路由层 `!autoDisabled`
- 仅 provider + upstream 级独立判定
- 通知 + 日志

### 阶段 2（未来）：增强

- Per-upstream 健康聚合到 provider 级（provider 健康状态 = 所有 upstreams 的聚合）
- 历史健康趋势表
- Admin UI 展示健康状态 + 手动触发检查按钮
- 健康检查结果 Prometheus 指标导出

### 阶段 3（未来）：统一任务框架

- 将现有 `setInterval` 周期任务（`refresh-litellm-pricing`、`expire-topup-orders`、`retry-webhook-deliveries`）统一迁移到 BullMQ repeatable job
- 引入任务注册表（central registry）统一管理生命周期
