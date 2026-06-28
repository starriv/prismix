# RFC: Outbound Proxy Pool with Credential-IP Affinity

- **Status**: Draft v2
- **Date**: 2026-04-12
- **Author**: Starriv + Claude

## Problem

当前网关所有出站请求共用单一出口 IP。上游供应商基于 IP 维度做速率限制和信誉评估：

1. **单 IP 高频** — 触发 429 速率限制
2. **单 IP 多凭证** — 大量不同 API 凭证从同一 IP 发出，被标记为 proxy/abuse
3. **IP 封禁** — 严重时整个 IP 被 block，所有凭证失效

### v1 方案的致命缺陷

如果凭证和 proxy 独立轮询（credential-balancer 选凭证，proxy-pool 选 proxy），同一个 API 凭证会在短时间内从不同 IP 发出请求：

```
10:00:01  credential-A → proxy-1 (IP 1.1.1.1) → OpenAI
10:00:02  credential-A → proxy-3 (IP 3.3.3.3) → OpenAI  ← 同一凭证，不同 IP
10:00:03  credential-A → proxy-2 (IP 2.2.2.2) → OpenAI  ← 更明显的代理特征
```

上游供应商的检测逻辑：

- **IP 跳变检测**：同一凭证短时间内源 IP 变化 → 判定代理/共享
- **IP 指纹聚类**：多个凭证在相同 IP 集合间跳变 → 判定批量代理
- **地理不一致**：同一凭证同时从不同地理位置请求 → 强异常信号

独立轮询不仅没有解决问题，反而**创造了比单 IP 更强的代理检测信号**。

## Core Insight

> **Credential 和 Proxy 不能独立选取，必须作为绑定的 "出口点" 一起调度。**

一个 API 凭证必须始终从同一个 IP 发出，就像它部署在一台固定服务器上一样。这意味着：

- Credential C1 永远走 Proxy P1（出口 IP 1.1.1.1）
- Credential C2 永远走 Proxy P2（出口 IP 2.2.2.2）
- Credential C3 也走 Proxy P1（一个代理可以绑多个凭证，但一个凭证只绑一个代理）

负载分散通过**在不同出口点之间轮询**实现，而非在一个凭证的代理之间轮询。

## Goals

- Credential-IP 强绑定：同一凭证始终从同一出口 IP 发出
- 出口点级别负载均衡：请求分散到不同出口点
- Per-endpoint 可配置：不同 endpoint 可用不同代理策略
- 遵循现有 Strategy 模式
- 代理故障时的平滑迁移（不是立刻跳 IP）
- 对 credential-balancer 最小侵入

## Non-Goals

- 不自建代理节点
- 不做出站内容审计
- 不做 IP 伪装/欺骗（我们是合法分散，不是隐匿）

---

## Design

### 1. Exit Point 模型

引入 **Exit Point（出口点）** 概念，将 Proxy 和 Credential 绑定为一个调度单元：

```
                        ┌─────────────────────────┐
                        │      Exit Point A       │
                        │  Proxy: P1 (1.1.1.1)   │
                        │  Credentials:  [C1, C3, C5]   │
                        └─────────────────────────┘

Request ──→ pick ──→    ┌─────────────────────────┐
                        │      Exit Point B       │
                        │  Proxy: P2 (2.2.2.2)   │
                        │  Credentials:  [C2, C4]      │
                        └─────────────────────────┘

                        ┌─────────────────────────┐
                        │      Exit Point C       │
                        │  Proxy: null (直连)     │
                        │  Credentials:  [C6, C7]      │
                        └─────────────────────────┘
```

**两级调度**：

1. **Level 1 — 选出口点**：在该 endpoint 的所有健康出口点之间做 SWRR（权重 = 出口点下所有凭证的权重之和）
2. **Level 2 — 选凭证**：在选中出口点内部的凭证之间做 SWRR（复用现有 credential-balancer 算法）

结果：**每次返回一个 `{ credential, proxy }` 对**，保证凭证和 proxy 始终配对。

### 2. Credential-Proxy 绑定方式

在 `ai_credentials` 表新增 `proxy_endpoint_id` 列：

```sql
ALTER TABLE ai_credentials
  ADD COLUMN proxy_endpoint_id INTEGER
  REFERENCES proxy_endpoints(id) ON DELETE SET NULL;
```

| `proxy_endpoint_id` | 含义                                      |
| ------------------- | ----------------------------------------- |
| `NULL`              | 未绑定 — 走直连（当前行为，完全向后兼容） |
| 有值                | 绑定到指定代理 — 该凭证的所有请求走此代理 |

**绑定策略**：

- **手动绑定**：Admin 在凭证管理页面选择代理（最常用，精确控制）
- **自动分配**：新增凭证时，如果 endpoint 有可用代理，按负载均衡自动分配到最空闲的代理
- **解绑**：删除代理时，`ON DELETE SET NULL` 自动解绑，凭证回退到直连

### 3. 为什么不用一致性哈希

| 方案               | 优点                               | 缺点                                                  |
| ------------------ | ---------------------------------- | ----------------------------------------------------- |
| **DB 显式绑定** ✅ | 稳定、可审计、admin 可控、重启不变 | 需要管理绑定关系                                      |
| 一致性哈希         | 无状态、自动                       | 代理增减时凭证大面积迁移 → 短时间凭证换 IP → 触发检测 |
| Redis 缓存亲和     | 灵活                               | 缓存丢失 = 凭证随机换 IP；冷启动不一致                |

DB 显式绑定是唯一能保证**跨重启、跨扩缩容、跨代理增减**都不会导致凭证意外换 IP 的方案。

### 4. 模块结构

```
src/server/proxy-pool/
  proxy-pool.ts              # Interface: ExitPoint + ProxyEndpoint 类型
  exit-point-pool.ts         # Impl: 两级 SWRR + 熔断
  index.ts                   # Barrel: factory + re-exports

src/server/ai/lib/
  credential-balancer.ts     # 修改：支持 exit-point 模式
  proxy-fetch.ts             # 新增：代理感知的 fetch 封装
```

### 5. Interface 定义

```ts
// proxy-pool.ts

export interface ProxyEndpoint {
  id: number;
  label: string;
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  auth?: { username: string; password: string };
  weight: number;
  /** 绑定到特定 endpoint（null = 通用） */
  endpointId: string | null;
}

export interface ExitPoint {
  proxy: ProxyEndpoint | null; // null = 直连出口点
  credentials: AiCredential[];
  /** 聚合权重 = sum(credentials.weight)，用于 Level 1 SWRR */
  totalCredentialWeight: number;
}

export interface ExitPointSelection {
  credential: AiCredential;
  proxy: ProxyEndpoint | null;
}

export interface ProxyHealth {
  endpointId: number;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  isHalfOpen: boolean;
  isCircuitOpen: boolean;
}

export interface ExitPointPool {
  /**
   * 两级选取：先选出口点（SWRR），再选凭证（SWRR）。
   * 返回绑定的 { credential, proxy } 对。
   * proxy = null 表示直连。
   */
  pick(endpointId: string): Promise<ExitPointSelection | undefined>;

  /** 上报成功 — 重置代理熔断计数 */
  reportSuccess(proxyEndpointId: number): void;

  /** 上报失败 — 累积熔断计数 */
  reportFailure(proxyEndpointId: number): void;

  stats(): ExitPointPoolStats;
  reload(): Promise<void>;
  close(): void;
}

export interface ExitPointPoolStats {
  totalExitPoints: number;
  healthyProxies: number;
  circuitOpenProxies: number;
  directConnectCredentials: number;
  proxiedCredentials: number;
}
```

### 6. 两级调度算法

```
pick(endpointId):

  ┌─ 1. 构建出口点列表 ─────────────────────────────────────┐
  │                                                          │
  │  a. 加载该 endpoint 的所有 enabled + weight>0 的凭证     │
  │  b. 按 proxy_endpoint_id 分组：                         │
  │     - NULL 组 → 直连出口点 { proxy: null, credentials: [...] } │
  │     - 非 NULL → 代理出口点 { proxy: P, credentials: [...] }    │
  │  c. 过滤掉 proxy 处于 circuitOpen 状态的出口点           │
  │     (其中的凭证暂时不可用，见 §7 故障策略)               │
  │  d. halfOpen 的代理出口点以 10% 概率保留（探测）         │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─ 2. Level 1: 选出口点 ──────────────────────────────────┐
  │                                                          │
  │  对剩余出口点做 SWRR                                     │
  │  权重 = exitPoint.totalCredentialWeight × proxy.weight   │
  │  (直连出口点的 proxy.weight 视为 1)                      │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─ 3. Level 2: 选凭证 ───────────────────────────────────-┐
  │                                                          │
  │  在选中出口点内部，对其凭证做 SWRR                       │
  │  权重 = credential.weight (与现有 credential-balancer 一致) │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  返回 { credential, proxy }
```

**与现有 credential-balancer 的关系**：

- **Proxy 功能关闭时**（`PROXY_POOL_ENABLED=false` 或无代理配置）：所有凭证的 `proxy_endpoint_id` 都是 NULL → 只有一个直连出口点 → Level 1 直接选中 → Level 2 退化为**完全等价于现有 credential-balancer** 的行为。零行为变化。
- **Proxy 功能开启时**：credential-balancer 的 `pickEndpointCredential()` 方法内部切换为两级调度，返回类型扩展为 `{ credential, proxy }`。

### 7. 代理故障策略：优先保持 IP 稳定

**核心原则**：代理故障时，宁可让绑定的凭证暂时不可用，也不要让凭证跳到其他 IP。

```
代理 P1 故障
    │
    ├─ 短期（< cooldownMs，默认 5 min）
    │   │
    │   └─ P1 上的凭证全部不可用
    │      fallback chain 会选其他出口点的凭证（不同凭证，不同 IP）
    │      对上游来说：C1 静默了一会儿（正常），C2 还在用（正常）
    │
    └─ 长期（≥ cooldownMs）
        │
        └─ 触发 "IP 迁移"：P1 上的凭证解绑（proxy_endpoint_id → NULL）
           凭证回退到直连出口点
           Admin 收到通知，手动重新绑定到新代理
           对上游来说：C1 换了 IP（但间隔了 5 分钟，看起来像正常网络变动）
```

**为什么短期内不做自动迁移**：

- 上游的 IP 跳变检测通常有时间窗口（几秒到几分钟）
- 5 分钟的静默期让上游认为 "这个凭证暂时没请求"（正常）
- 5 分钟后换 IP 看起来像用户更换了服务器（正常）
- 如果立刻迁移，P1 故障恢复后凭证又跳回来 → 短时间两次 IP 变化 → 强代理信号

**熔断参数**：

| 参数                  | 默认值  | 说明                               |
| --------------------- | ------- | ---------------------------------- |
| `failureThreshold`    | 5       | 连续失败 N 次后熔断（circuitOpen） |
| `halfOpenResetMs`     | 30_000  | 熔断后 30s 进入半开探测            |
| `halfOpenProbeRate`   | 0.1     | 半开状态 10% 概率放行探测请求      |
| `migrationCooldownMs` | 300_000 | 熔断超过 5 min → 触发凭证解绑迁移  |

### 8. 与 Fallback Chain 的交互

Admin relay 有 fallback chain（primary model + fallback models）。现在每个 candidate 的 `resolveCandidate()` 返回的是 `{ credential, proxy }` 对：

```
Fallback chain:
  Candidate 1 (GPT-4o)  → pick() → { credential: C1, proxy: P1 } → fetch via P1
                            ↓ 429
  Candidate 2 (GPT-4o-mini) → pick() → { credential: C3, proxy: P2 } → fetch via P2
                            ↓ 200 ✓

注意：C1 始终走 P1，C3 始终走 P2。
即使 fallback 换了模型，credential-proxy 绑定不变。
```

如果某个出口点的代理被熔断，该出口点下的所有凭证暂不可用，`pick()` 会跳过它们 → fallback chain 自然选到其他出口点的凭证。这对上游来说，就是 "C1 这个凭证暂时没请求了，C3 还在正常用"，完全正常。

### 9. 数据存储

#### 新建 `proxy_endpoints` 表

```sql
CREATE TABLE proxy_endpoints (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  protocol    TEXT NOT NULL DEFAULT 'http',       -- http | https | socks5
  host        TEXT NOT NULL,
  port        INT NOT NULL,
  auth_user   TEXT,
  auth_pass_encrypted TEXT,                       -- encrypt(), domain tag: "proxy-endpoint"
  weight      INT NOT NULL DEFAULT 1,             -- 0 = 禁用
  endpoint_id TEXT,                               -- NULL = 通用
  is_enabled  BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_endpoint FOREIGN KEY (endpoint_id)
    REFERENCES ai_endpoints(endpoint_id) ON DELETE SET NULL
);
```

#### 修改 `ai_credentials` 表

```sql
ALTER TABLE ai_credentials
  ADD COLUMN proxy_endpoint_id INTEGER
  REFERENCES proxy_endpoints(id) ON DELETE SET NULL;

CREATE INDEX idx_ai_credentials_proxy_endpoint_id ON ai_credentials(proxy_endpoint_id);
```

#### 扩展 `ai_usage_logs` 表

```sql
ALTER TABLE ai_usage_logs
  ADD COLUMN proxy_endpoint_id INTEGER;           -- 非 FK（热路径表规则）
```

### 10. Credential-Balancer 改造

现有 `pickEndpointCredential(endpointId, upstreamId)` 签名变为：

```ts
// 新增类型
export interface CredentialSelection {
  credential: AiCredential;
  proxy: ProxyEndpoint | null;
}

// 签名变化
export async function pickEndpointCredential(
  endpointId: number,
  upstreamId: number | null,
): Promise<CredentialSelection | undefined>;
```

内部逻辑：

```ts
async function pickEndpointCredential(
  endpointId: number,
  upstreamId: number | null,
): Promise<CredentialSelection | undefined> {
  if (!proxyPoolEnabled()) {
    // 向后兼容：无代理 → 现有行为
    const credential = await pickCredentialLegacy(endpointId, upstreamId);
    return credential ? { credential, proxy: null } : undefined;
  }

  // 两级调度
  return exitPointPool.pick(endpointId);
}
```

调用方无需感知内部是否走了代理 — `credential` 字段与现有完全兼容，`proxy` 字段由 `proxy-fetch.ts` 消费。

### 11. fetch 集成

```ts
// src/server/ai/lib/proxy-fetch.ts
import { ProxyAgent } from "undici";

import type { ProxyEndpoint } from "@/server/proxy-pool";

export async function proxyFetch(
  url: string,
  init: RequestInit,
  proxy: ProxyEndpoint | null,
): Promise<Response> {
  if (!proxy) {
    return fetch(url, init);
  }

  const proxyUrl = formatProxyUrl(proxy);
  const dispatcher = new ProxyAgent({ uri: proxyUrl });

  return fetch(url, {
    ...init,
    // @ts-expect-error — undici dispatcher on global fetch
    dispatcher,
  });
}
```

`fetchUpstream()` 和 relay 路由中的直接 `fetch()` 调用均改为传入 `proxy-fetch`，proxy 参数来自 `pickEndpointCredential()` 返回的 `selection.proxy`。

### 12. Admin 管理

#### API

```
GET    /api/admin/proxy-endpoints              -- 列表（分页）
POST   /api/admin/proxy-endpoints              -- 新增
PATCH  /api/admin/proxy-endpoints/:id          -- 编辑
DELETE /api/admin/proxy-endpoints/:id          -- 删除
POST   /api/admin/proxy-endpoints/:id/test     -- 测试连通性（返回出口 IP）
GET    /api/admin/proxy-endpoints/stats        -- 池状态

PATCH  /api/admin/ai/credentials/:id/proxy     -- 绑定/解绑凭证的代理
POST   /api/admin/proxy-endpoints/:id/auto-assign  -- 自动分配未绑定的凭证
```

#### 前端

**代理管理页** `proxy-endpoints.tsx`：

- 表格：label / host:port / protocol / weight / endpoint / 绑定凭证数 / 健康状态
- 新增/编辑 Dialog
- 测试连通性（返回出口 IP）
- "自动分配凭证" 按钮

**凭证管理页增强** `ai-credentials.tsx`：

- 新增 "代理" 列，显示绑定的代理 label（或 "直连"）
- 凭证编辑 Dialog 增加代理选择下拉框
- 批量操作：选中多个凭证 → 批量绑定到某代理

### 13. 环境变量

```env
# ── Proxy Pool ──
# PROXY_POOL_ENABLED=true                # 总开关，默认 false
# PROXY_POOL_FAILURE_THRESHOLD=5         # 连续失败 N 次后熔断
# PROXY_POOL_HALF_OPEN_RESET_MS=30000    # 熔断后进入半开的等待时间
# PROXY_POOL_MIGRATION_COOLDOWN_MS=300000  # 熔断超时后凭证解绑的冷却期
```

### 14. 可观测性

| 信号             | 级别  | 内容                                                            |
| ---------------- | ----- | --------------------------------------------------------------- |
| 出口点选取       | debug | `{ exitPoint, credentialId, proxyId, endpointId }`              |
| 代理请求失败     | warn  | `{ proxyId, host, consecutiveFailures }`                        |
| 代理熔断         | error | `{ proxyId, affectedCredentialCount }` + EventBus emit          |
| 凭证迁移（解绑） | warn  | `{ credentialId, fromProxyId, reason: "circuit-open-timeout" }` |
| 代理恢复         | info  | `{ proxyId, recoveredCredentialCount }`                         |
| Usage log        | —     | `proxy_endpoint_id` 列记录每次请求的出口                        |

---

## Threat Model: 上游检测手段 vs 我们的应对

| 上游检测手段                 | 独立轮询（v1）被检测？ | Exit Point 模型被检测？           |
| ---------------------------- | ---------------------- | --------------------------------- |
| 同一凭证短时间换 IP          | ✅ 必被检测            | ❌ 凭证固定 IP                    |
| 同一 IP 大量不同凭证         | ⚠️ 部分缓解            | ❌ 每个 IP 只有少量绑定凭证       |
| IP 地理跳变                  | ✅ 严重                | ❌ 固定 IP = 固定地理             |
| 凭证使用模式异常 (burst)     | ⚠️ 无关代理            | ⚠️ 无关代理（靠 rate limit 控制） |
| IP 信誉库（已知数据中心 IP） | ⚠️ 取决于代理质量      | ⚠️ 取决于代理质量（住宅 > DC）    |
| TLS 指纹 (JA3/JA4)           | ❌ 同一 runtime        | ❌ 同一 runtime                   |

**Exit Point 模型消除了最高风险的前三项检测**。剩余风险（burst、IP 信誉、TLS 指纹）与代理架构无关，需要其他手段处理。

---

## Migration Path

### Phase 1: 基础模块 + DB

1. `proxy_endpoints` 表 + Drizzle schema
2. `ai_credentials` 表新增 `proxy_endpoint_id` 列
3. `src/server/proxy-pool/` 模块（interface + exit-point-pool impl + barrel）
4. `proxy-fetch.ts` 封装
5. 添加 `undici` 依赖
6. 环境变量更新
7. 单元测试：两级 SWRR 分布、熔断、迁移冷却

### Phase 2: Credential-Balancer 集成

1. `pickEndpointCredential()` 返回类型改为 `CredentialSelection`
2. `fetchUpstream()` 接入 proxy-fetch
3. `relay.ts` / `consumer-relay.ts` 适配新返回类型
4. 失败上报集成到 fallback chain
5. `ai_usage_logs` 扩展列
6. 集成测试

### Phase 3: Admin UI

1. 代理端点 CRUD API + 前端页面
2. 凭证管理页增加代理绑定 UI
3. 自动分配功能
4. 连通性测试
5. 池状态监控 + SSE 事件推送
6. E2E 测试

---

## Alternatives Considered

### A. 独立轮询（v1 方案）

Credential-balancer 和 proxy-pool 各自独立选取。
**致命问题**：同一凭证在不同 IP 间跳变，比单 IP 更容易被检测。已否决。

### B. 一致性哈希绑定

`hash(credential_id) % proxy_count` 自动映射。
**问题**：代理增减时大面积重映射 → 短时间大量凭证换 IP → 触发检测。且不可审计、不可手动干预。

### C. Redis 缓存亲和

首次请求缓存 `credential→proxy` 映射，TTL 24h。
**问题**：Redis 重启/缓存过期 = 全部凭证随机换 IP。冷启动风暴。

### D. 系统级代理 / Sidecar

同 v1 RFC 分析，无法实现 per-credential 粒度的 IP 固定。

**选择方案 E（DB 显式绑定 + Exit Point 两级调度）**：唯一能在所有运维场景（重启、扩缩容、代理增减）下保持 credential-IP 稳定性的方案。

---

## Open Questions

1. **SOCKS5 优先级** — `undici` ProxyAgent 原生支持 HTTP/HTTPS。SOCKS5 需要 `socks-proxy-agent`，是否 Phase 1 就支持？
2. **Bun 兼容性** — `undici` dispatcher 在 Bun runtime 的兼容性需验证。
3. **代理池数据源** — 仅 DB 管理，还是支持外部 API 拉取？
4. **Consumer relay 走代理** — 流量大，代理成本显著。可以先 admin-only？
5. **自动分配算法** — 按凭证数均分，还是按权重均分，还是按流量均分？
6. **多进程 SWRR 一致性** — exit-point-pool 的 SWRR 状态是进程本地的。多实例部署时各进程独立轮询，可接受（等同于现有 credential-balancer 行为）？
