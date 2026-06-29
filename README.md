# Prismix

## 中文

### 项目介绍

Prismix 是一个 AI 网关和计费后台。它把用户请求转发到不同的 AI 供应商，同时管理模型路由、上游凭证、消费者密钥、余额、用量日志、通知和 Webhook。

适合的场景：

- 用一个统一入口接入 OpenAI、Anthropic、Gemini、Azure、Bedrock 或兼容 OpenAI 协议的上游。
- 给用户发放 `ska_` 开头的消费者密钥，并限制可用模型、频率和消费额度。
- 按请求记录用量和成本，基于 Pay Agent 余额扣费。
- 在后台管理模型、供应商、端点、上游、凭证、用户、充值、提现、通知和系统配置。

### 架构总览

Prismix 由四部分组成：

| 层        | 技术                                                    | 职责                                             |
| --------- | ------------------------------------------------------- | ------------------------------------------------ |
| 前端      | React、Vite、React Router、TanStack Query、Tailwind CSS | 管理后台、用户后台、公开文档页                   |
| API       | Hono on Node.js                                         | AI 网关 + 管理 API，生产环境同时托管打包后的前端 |
| 数据库    | PostgreSQL + Drizzle ORM                                | 用户、密钥、模型路由、账本、日志、系统配置       |
| 缓存/队列 | Redis                                                   | 缓存、限流、异步写队列、跨实例事件同步           |

#### 请求生命周期

```
HTTP POST /api/gateway/ai/openai/v1/chat/completions
  Authorization: Bearer ska_xxxx
  Body: { model, messages, stream }
   │
   ▼
L1 全局中间件链
   requestId → secureHeaders → httpLogger → CORS
   → bodyLimit(20MB AI / 1MB other) → rateLimiter → errorHandler
   │
   ▼
L2 消费者密钥认证 (consumerKeyAuthMiddleware)
   提取 ska_ → SHA-256 → DB 查询 → 状态/过期/RPM 限流
   → Pay-Agent 余额检查 → 注入 ConsumerSession
   │
   ▼
L3 路由处理 (consumer-relay.ts)
   Zod 校验 → 模型 ACL → 输入 Guardrails → 三层路由解析
   → 语义缓存检查 → 预检日/月限额
   │
   ▼
L4 上游执行 + 重试
   fetchUpstream (可重试) → forwardStream (不可回退)
   流式：SSE 逐帧转发 + 异步扣费
   非流式：JSON 转换 + 同步扣费 + 语义缓存写入
   │
   ▼
L5 异步写入 (enqueueJob, 不阻塞响应)
   agent-ai-txn / ai-usage-log / ai-request-log
   consumer-key-touch / ai-endpoint-credential-touch
```

完整链路文档见 [`docs/architecture/request-lifecycle.md`](docs/architecture/request-lifecycle.md)。

#### 三层路由解析

模型到上游的实际转发分三层独立配置，可任意组合：

```
用户请求 model = "claude-opus-4-7"
   │
   ▼
第一层：模型 → 端点          (ai_model_routes)
   决定由哪个协议端点处理，可在路由级覆盖模型名
   输出: endpointModelId = route.endpointModelId ?? model.modelId
   │
   ▼
第二层：端点 → 上游          (ai_upstream_assignments)
   决定发往哪个上游端点，按 priority ASC + weight 加权随机排序
   输出: upstream (baseUrl, id, ...)
   │
   ▼
第三层：上游 → 实际模型名     (ai_upstream_model_mappings)
   决定发给该上游时使用的真实模型 ID，无映射则原样透传
   输出: effectiveModelId = mapping[endpointModelId] ?? endpointModelId
   │
   ▼
POST {upstream.baseUrl}  Body: { model: effectiveModelId, ... }
```

解析优先级：`upstream_mapping > route.endpointModelId > model.modelId`。

详细文档见 [`docs/architecture/ai-routing.md`](docs/architecture/ai-routing.md)。

### 核心子系统

#### 凭证池负载均衡

[`src/server/ai/lib/credential-balancer.ts`](src/server/ai/lib/credential-balancer.ts)

- **内存 SWRR**（Smooth Weighted Round-Robin，Nginx 风格）：绕过 DB LRU 竞态，同步轮转
- 两种策略：`round-robin`（默认，确定性加权轮转）/ `random`（加权概率）
- **健康惩罚**：失败次数指数退避，`penaltyMs = min(30s · 2^(n-1), 2min)`，惩罚期内 effectiveWeight 按比例衰减
- 成功立即恢复，无冷却期

#### 上游候选缓存

[`src/server/ai/lib/upstream-routing.ts`](src/server/ai/lib/upstream-routing.ts)

- 30s TTL 内存缓存，key 为 `endpointId`
- 始终追加 legacy target（endpoint 自身 `baseUrl`，priority=1000）作为兜底
- 策略：`weighted-random` 用 `weightedShuffle`；否则 `priority ASC, weight DESC, name ASC`
- CRUD 后调用 `invalidateUpstreamCache` / `invalidateUpstreamCacheForUpstream`

#### 端点鉴权

[`src/server/ai/lib/endpoint-auth.ts`](src/server/ai/lib/endpoint-auth.ts)

| Auth 类型    | 输出                                              | 用途                   |
| ------------ | ------------------------------------------------- | ---------------------- |
| `bearer`     | `Authorization: Bearer <key>`                     | OpenAI 等              |
| `api-key`    | 自定义 header（默认 `x-api-key`）                 | Anthropic              |
| `cloudflare` | `CF-Access-Client-Id` + `CF-Access-Client-Secret` | Cloudflare Access 代理 |
| `gemini`     | `?key=<key>` query 参数                           | Google Gemini          |
| `sigv4`      | AWS4-HMAC-SHA256 完整签名                         | AWS Bedrock            |

SigV4 使用 Node.js 原生 `crypto.createHmac("sha256")` 实现，无 AWS SDK 依赖。`anthropic` 和 `bedrock` apiFormat 强制注入 `anthropic-version: 2023-06-01`。

#### 协议适配器

[`src/server/ai/protocol-adapters/`](src/server/ai/protocol-adapters/)

5 个适配器（openai / anthropic / gemini / azure-openai / bedrock）实现统一接口：`transformRequest`、`transformResponse`、`extractUsage`、`transformStreamEvent`、`extractStreamUsage`、`isStreamDone`、`buildUrl`。

Anthropic 客户端协议（`/v1/messages`）在网关内被转码为 canonical OpenAI Chat 格式，可路由到任意端点，响应再转回 Anthropic 形态。

#### 计费管道

[`src/server/ai/lib/billing.ts`](src/server/ai/lib/billing.ts)

```
upstreamCost  = (inputTokens · inputPrice + outputTokens · outputPrice) / 1,000,000
consumerCost  = upstreamCost · (1 + markupPercent / 100)
markupPercent = consumer.markupPercent ?? agent.defaultMarkupPercent ?? globalDefault(60s 缓存)
```

- **原子扣款**：`UPDATE pay_agents SET balance = balance - $cost WHERE id = $id AND balance >= $cost`，避免 TOCTOU
- **限额三道关**：预检（已超标）→ 响应前（含本次会超标）→ 流后（仅挂起 agent）
- **Key Provider 分润**：当 key 有 `ownerId` 时，`share = (consumerCost - upstreamCost) · revenueSharePercent / 100` 计入 provider 余额

#### 流式 SSE 转发

[`src/server/ai/lib/stream-proxy.ts`](src/server/ai/lib/stream-proxy.ts)

两阶段设计，兼顾容错与语义正确：

- `fetchUpstream()`：只 fetch，不提交 SSE headers → **可重试**
- `forwardStream()`：SSE headers 已发送 → **不可回退**

韧性参数：

| 参数                     | 默认   | 作用                     |
| ------------------------ | ------ | ------------------------ |
| `STREAM_IDLE_TIMEOUT_MS` | 5 min  | 上游无数据则中断         |
| `STREAM_MAX_DURATION_MS` | 30 min | 流式硬上限               |
| `HEARTBEAT_INTERVAL_MS`  | 15 s   | SSE 心跳防代理断连       |
| `MAX_BUFFER_SIZE`        | 1 MB   | SSE 缓冲溢出保护         |
| `upstreamFetchMs`        | 120 s  | 等待首字节（含思考模型） |

通用 usage 提取通过 SSE event `type` 字段区分 OpenAI / Anthropic / Gemini / OpenAI Responses API，避免每个适配器写独立解析器。

#### 异步写入系统

所有计费和日志通过 `enqueueJob()` 异步处理，不阻塞 HTTP 响应：

| Job                            | 处理方式                | 内容                         |
| ------------------------------ | ----------------------- | ---------------------------- |
| `agent-ai-txn`                 | write handler           | 交易记录 + Key Provider 分润 |
| `ai-usage-log`                 | batch (50 条/1s)        | 用量日志批量 INSERT          |
| `ai-request-log`               | write handler（按开关） | 请求/响应体日志              |
| `consumer-key-touch`           | write handler           | 更新 `last_used_at`          |
| `ai-endpoint-credential-touch` | write handler           | 更新凭证 `last_used_at`      |

降级：Redis 不可用时静默丢弃 + 节流告警，计费交易仍写入。

### 流式 vs 非流式

| 维度      | 流式                                 | 非流式                        |
| --------- | ------------------------------------ | ----------------------------- |
| 响应方式  | SSE 逐帧转发                         | 一次性 JSON                   |
| 计费时机  | 流结束后异步（响应已发送，不可回退） | 响应前同步（可拒绝）          |
| 单次限额  | 流后检查，超限挂起 Agent             | 响应前检查，超限返回 429      |
| 日/月限额 | 仅预检                               | 预检 + 响应前二次检查         |
| 语义缓存  | 不参与                               | 读 + 写                       |
| 超时      | 空闲 5 min + 硬限 30 min + 心跳 15 s | `AbortSignal.timeout(30 min)` |
| 重试      | SSE headers 前可重试，之后不可       | 5 次候选内任意重试            |

### 核心数据模型

| 表                             | 用途                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `relay_consumer_keys`          | 消费者 API Key（hash、allowedModels、markup、限额）  |
| `relay_consumer_key_blacklist` | 已删除 Key 防重放                                    |
| `pay_agents`                   | 钱包/余额账户                                        |
| `pay_agent_transactions`       | 交易流水                                             |
| `ai_suppliers`                 | 供应商（真实厂商，如 DeepSeek、OpenAI）              |
| `ai_models`                    | 模型目录（价格、fallback）                           |
| `ai_model_routes`              | 模型 → 端点路由（priority、weight、endpointModelId） |
| `ai_supplier_connections`      | 供应商连接（apiFormat、authType、负载均衡策略）      |
| `ai_credentials`               | 上游 API 凭证（AES-256-GCM 加密存储）                |
| `ai_endpoint_credentials`      | 端点 ↔ 凭证绑定（含 upstreamId、weight）             |
| `ai_upstreams`                 | 上游端点（baseUrl、kind、modelsEndpoint）            |
| `ai_upstream_assignments`      | 端点 ↔ 上游 N:N 绑定                                 |
| `ai_upstream_model_mappings`   | 上游级模型名重映射                                   |
| `ai_guardrail_configs`         | 内容审核规则                                         |

### 关键设计决策

1. **三层路由解耦** — 模型名、端点、上游、上游模型名四层标识独立配置，支持「同一模型多端点」「同端点多上游」「同上游不同模型名映射」。
2. **内存 SWRR 凭证池** — 绕过 DB LRU 竞态，Nginx 风格平滑加权轮转 + 指数退避惩罚。
3. **非阻塞写** — 计费、日志、交易、touch 全部异步，响应时间不受 DB 延迟影响。
4. **缓存命中免费** — 语义缓存命中不计费，鼓励请求重用，降低系统负载。
5. **流式两阶段** — `fetchUpstream` 可重试 + `forwardStream` 不可回退，最大化容错又保证语义正确。
6. **Fail-Closed 安全** — `allowedModels` JSON 损坏 → 500 拒绝；guardrails 异常 → 警告后放行。
7. **Markup 三层优先级** — per-key > agent default > global（60s 缓存避免热点）。
8. **两层标识隔离** — 外部 `uuid` 在路由边界解析为内部 `id`，下游统一用内部 `id`。

### 技术栈

- **后端**：Hono、Node.js 20+、Drizzle ORM、PostgreSQL、Redis (ioredis)、BullMQ、Pino、Prometheus client
- **前端**：React 19、Vite、React Router 7、TanStack Query/Table、Tailwind CSS 4、shadcn/ui、Radix UI、Recharts、react-three-fiber
- **认证**：JWT (jose)、argon2、Passport (Google OAuth)、SAML (@node-saml/node-saml)、OIDC
- **加密**：AES-256-GCM（密钥静态加密）、PBKDF2 密钥派生、SHA-256（Key hash）
- **AI SDK**：原生 fetch，无 OpenAI/Anthropic SDK 依赖；`@modelcontextprotocol/sdk` for MCP
- **区块链**：viem、wagmi、RainbowKit、Alchemy RPC
- **构建/测试**：tsup（server）、Vite（web）、Vitest、Playwright、MSW、ESLint、Prettier

---

## English

### What It Is

Prismix is an AI gateway and billing console. It forwards user requests to AI suppliers and manages model routing, upstream credentials, consumer keys, balances, usage logs, notifications, and webhooks.

Use it when you need to:

- Expose one gateway for OpenAI, Anthropic, Gemini, Azure, Bedrock, or OpenAI-compatible upstreams.
- Issue consumer keys starting with `ska_` and control allowed models, rate limits, and spend limits.
- Track usage and cost per request, then charge a Pay Agent balance.
- Manage models, suppliers, endpoints, upstreams, credentials, users, top-ups, withdrawals, notifications, and system settings from a web console.

### Architecture Overview

Prismix has four main parts:

| Layer       | Stack                                                   | Responsibility                                                   |
| ----------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Frontend    | React, Vite, React Router, TanStack Query, Tailwind CSS | Admin console, user portal, public docs                          |
| API         | Hono on Node.js                                         | AI gateway + admin API; also serves built frontend in production |
| Database    | PostgreSQL + Drizzle ORM                                | Users, keys, model routes, ledger, logs, settings                |
| Cache/Queue | Redis                                                   | Cache, rate limiting, async write queue, cross-instance events   |

#### Request Lifecycle

```
HTTP POST /api/gateway/ai/openai/v1/chat/completions
  Authorization: Bearer ska_xxxx
  Body: { model, messages, stream }
   │
   ▼
L1 Global middleware chain
   requestId → secureHeaders → httpLogger → CORS
   → bodyLimit(20MB AI / 1MB other) → rateLimiter → errorHandler
   │
   ▼
L2 Consumer key auth (consumerKeyAuthMiddleware)
   Extract ska_ → SHA-256 → DB lookup → status/expiry/RPM check
   → Pay-Agent balance gate → inject ConsumerSession
   │
   ▼
L3 Route handler (consumer-relay.ts)
   Zod validation → model ACL → input guardrails → 3-layer routing
   → semantic cache check → pre-flight daily/monthly limits
   │
   ▼
L4 Upstream execution + retry
   fetchUpstream (retryable) → forwardStream (non-retryable)
   Streaming: SSE frame-by-frame forwarding + async billing
   Non-streaming: JSON transform + sync billing + cache write
   │
   ▼
L5 Async writes (enqueueJob, non-blocking)
   agent-ai-txn / ai-usage-log / ai-request-log
   consumer-key-touch / ai-endpoint-credential-touch
```

Full lifecycle doc: [`docs/architecture/request-lifecycle.md`](docs/architecture/request-lifecycle.md).

#### Three-Layer Routing

Routing from a requested model to a concrete upstream is split into three independent, composable layers:

```
Request model = "claude-opus-4-7"
   │
   ▼
Layer 1: model → endpoint        (ai_model_routes)
   Decides which protocol endpoint serves the model. Route can override the model name.
   Output: endpointModelId = route.endpointModelId ?? model.modelId
   │
   ▼
Layer 2: endpoint → upstream     (ai_upstream_assignments)
   Decides which upstream endpoint receives the request.
   Sorted by priority ASC + weight weighted-random within a priority group.
   Output: upstream (baseUrl, id, ...)
   │
   ▼
Layer 3: upstream → effective model name   (ai_upstream_model_mappings)
   Decides the actual model ID sent to that upstream. Pass-through if no mapping.
   Output: effectiveModelId = mapping[endpointModelId] ?? endpointModelId
   │
   ▼
POST {upstream.baseUrl}  Body: { model: effectiveModelId, ... }
```

Resolution precedence: `upstream_mapping > route.endpointModelId > model.modelId`.

Detailed doc: [`docs/architecture/ai-routing.md`](docs/architecture/ai-routing.md).

### Core Subsystems

#### Credential Pool Load Balancer

[`src/server/ai/lib/credential-balancer.ts`](src/server/ai/lib/credential-balancer.ts)

- **In-memory SWRR** (Smooth Weighted Round-Robin, Nginx-style): bypasses DB LRU races, rotates synchronously
- Two strategies: `round-robin` (default, deterministic weighted rotation) / `random` (probabilistic weighted)
- **Health penalty**: exponential backoff on failure, `penaltyMs = min(30s · 2^(n-1), 2min)`; effectiveWeight decays proportionally during penalty
- Success resets penalty immediately

#### Upstream Candidate Cache

[`src/server/ai/lib/upstream-routing.ts`](src/server/ai/lib/upstream-routing.ts)

- 30s TTL in-memory cache keyed by `endpointId`
- Always appends a legacy target (endpoint's own `baseUrl`, priority=1000) as fallback
- Strategy: `weighted-random` → `weightedShuffle`; otherwise `priority ASC, weight DESC, name ASC`
- Invalidated via `invalidateUpstreamCache` / `invalidateUpstreamCacheForUpstream` on CRUD

#### Endpoint Auth

[`src/server/ai/lib/endpoint-auth.ts`](src/server/ai/lib/endpoint-auth.ts)

| Auth type    | Output                                            | Used for                |
| ------------ | ------------------------------------------------- | ----------------------- |
| `bearer`     | `Authorization: Bearer <key>`                     | OpenAI etc.             |
| `api-key`    | Custom header (default `x-api-key`)               | Anthropic               |
| `cloudflare` | `CF-Access-Client-Id` + `CF-Access-Client-Secret` | Cloudflare Access proxy |
| `gemini`     | `?key=<key>` query param                          | Google Gemini           |
| `sigv4`      | Full AWS4-HMAC-SHA256 signature                   | AWS Bedrock             |

SigV4 is implemented with native Node.js `crypto.createHmac("sha256")` — no AWS SDK dependency. `anthropic` and `bedrock` apiFormat force-inject `anthropic-version: 2023-06-01`.

#### Protocol Adapters

[`src/server/ai/protocol-adapters/`](src/server/ai/protocol-adapters/)

Five adapters (openai / anthropic / gemini / azure-openai / bedrock) implement a uniform interface: `transformRequest`, `transformResponse`, `extractUsage`, `transformStreamEvent`, `extractStreamUsage`, `isStreamDone`, `buildUrl`.

The Anthropic client protocol (`/v1/messages`) is transcoded to a canonical OpenAI Chat format inside the gateway, routable to any endpoint, then converted back to Anthropic shape on response.

#### Billing Pipeline

[`src/server/ai/lib/billing.ts`](src/server/ai/lib/billing.ts)

```
upstreamCost  = (inputTokens · inputPrice + outputTokens · outputPrice) / 1,000,000
consumerCost  = upstreamCost · (1 + markupPercent / 100)
markupPercent = consumer.markupPercent ?? agent.defaultMarkupPercent ?? globalDefault(60s cache)
```

- **Atomic debit**: `UPDATE pay_agents SET balance = balance - $cost WHERE id = $id AND balance >= $cost` — avoids TOCTOU
- **Three limit gates**: pre-flight (already exceeded) → pre-response (would exceed with this call) → post-stream (suspend agent only)
- **Key Provider revenue share**: when a key has an `ownerId`, `share = (consumerCost - upstreamCost) · revenueSharePercent / 100` is credited to the provider's balance

#### SSE Stream Forwarding

[`src/server/ai/lib/stream-proxy.ts`](src/server/ai/lib/stream-proxy.ts)

Two-stage design balancing fault tolerance and semantic correctness:

- `fetchUpstream()`: fetch only, no SSE headers committed → **retryable**
- `forwardStream()`: SSE headers sent → **non-retryable**

Resilience parameters:

| Param                    | Default | Purpose                                    |
| ------------------------ | ------- | ------------------------------------------ |
| `STREAM_IDLE_TIMEOUT_MS` | 5 min   | Abort if upstream is silent                |
| `STREAM_MAX_DURATION_MS` | 30 min  | Hard cap on stream duration                |
| `HEARTBEAT_INTERVAL_MS`  | 15 s    | SSE comment to keep proxies alive          |
| `MAX_BUFFER_SIZE`        | 1 MB    | SSE buffer overflow guard                  |
| `upstreamFetchMs`        | 120 s   | Time-to-first-byte (incl. thinking models) |

Universal usage extraction discriminates OpenAI / Anthropic / Gemini / OpenAI Responses API by SSE event `type`, avoiding per-adapter parsers.

#### Async Write System

All billing and log writes go through `enqueueJob()` and never block HTTP responses:

| Job                            | Handling               | Content                                         |
| ------------------------------ | ---------------------- | ----------------------------------------------- |
| `agent-ai-txn`                 | write handler          | Transaction record + Key Provider revenue share |
| `ai-usage-log`                 | batch (50/1s)          | Batch INSERT usage logs                         |
| `ai-request-log`               | write handler (opt-in) | Request/response body logs                      |
| `consumer-key-touch`           | write handler          | Update `last_used_at`                           |
| `ai-endpoint-credential-touch` | write handler          | Update credential `last_used_at`                |

Degradation: silent drop + throttled warning when Redis is unavailable; billing transactions still write through.

### Streaming vs Non-Streaming

| Aspect                | Streaming                                       | Non-streaming                     |
| --------------------- | ----------------------------------------------- | --------------------------------- |
| Response              | SSE frame-by-frame                              | One-shot JSON                     |
| Billing timing        | Async after stream (response sent, irrevocable) | Sync before response (can reject) |
| Per-transaction limit | Post-stream check; suspend agent on exceed      | Pre-response check; return 429    |
| Daily/Monthly limits  | Pre-flight only                                 | Pre-flight + pre-response recheck |
| Semantic cache        | Not used                                        | Read + write                      |
| Timeout               | Idle 5 min + hard 30 min + heartbeat 15 s       | `AbortSignal.timeout(30 min)`     |
| Retry                 | Retryable before SSE headers; not after         | Up to 5 candidates                |

### Core Data Model

| Table                          | Purpose                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| `relay_consumer_keys`          | Consumer API key (hash, allowedModels, markup, limits)           |
| `relay_consumer_key_blacklist` | Replay protection for deleted keys                               |
| `pay_agents`                   | Wallet / balance account                                         |
| `pay_agent_transactions`       | Transaction ledger                                               |
| `ai_suppliers`                 | Suppliers (real vendors, e.g. DeepSeek, OpenAI)                  |
| `ai_models`                    | Model catalog (pricing, fallback)                                |
| `ai_model_routes`              | Model → endpoint routes (priority, weight, endpointModelId)      |
| `ai_supplier_connections`      | Supplier connection (apiFormat, authType, load-balance strategy) |
| `ai_credentials`               | Upstream API credentials (AES-256-GCM at rest)                   |
| `ai_endpoint_credentials`      | Endpoint ↔ credential binding (with upstreamId, weight)          |
| `ai_upstreams`                 | Upstream endpoints (baseUrl, kind, modelsEndpoint)               |
| `ai_upstream_assignments`      | Endpoint ↔ upstream N:N binding                                  |
| `ai_upstream_model_mappings`   | Per-upstream model name override                                 |
| `ai_guardrail_configs`         | Content moderation rules                                         |

### Key Design Decisions

1. **Three-layer routing decoupling** — Model name, endpoint, upstream, and per-upstream model name are independently configured, supporting "one model → many endpoints", "one endpoint → many upstreams", "one upstream → different model names".
2. **In-memory SWRR credential pool** — Bypasses DB LRU races with Nginx-style smooth weighted rotation + exponential backoff penalty.
3. **Non-blocking writes** — Billing, logs, transactions, and touch updates are all async; response time is immune to DB latency.
4. **Free semantic cache hits** — Cache hits are not billed, encouraging request reuse and lowering system load.
5. **Two-stage streaming** — `fetchUpstream` retryable + `forwardStream` irrevocable; maximizes fault tolerance without breaking semantics.
6. **Fail-closed safety** — Corrupted `allowedModels` JSON → 500; guardrail exceptions → warn-and-proceed.
7. **Markup priority** — per-key > agent default > global (60s cache to avoid hotspots).
8. **Two-layer identity isolation** — External `uuid` is resolved to internal `id` at the routing boundary; downstream logic uses internal `id` uniformly.

### Tech Stack

- **Backend**: Hono, Node.js 20+, Drizzle ORM, PostgreSQL, Redis (ioredis), BullMQ, Pino, Prometheus client
- **Frontend**: React 19, Vite, React Router 7, TanStack Query/Table, Tailwind CSS 4, shadcn/ui, Radix UI, Recharts, react-three-fiber
- **Auth**: JWT (jose), argon2, Passport (Google OAuth), SAML (@node-saml/node-saml), OIDC
- **Crypto**: AES-256-GCM (key encryption at rest), PBKDF2 key derivation, SHA-256 (key hash)
- **AI SDK**: Native fetch, no OpenAI/Anthropic SDK dependency; `@modelcontextprotocol/sdk` for MCP
- **Blockchain**: viem, wagmi, RainbowKit, Alchemy RPC
- **Build/Test**: tsup (server), Vite (web), Vitest, Playwright, MSW, ESLint, Prettier
