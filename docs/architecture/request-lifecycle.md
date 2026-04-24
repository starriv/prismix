# 请求生命周期

客户端通过消费者密钥（`ska_`）调用 AI 网关的完整链路，从 consumer key 认证到上游 AI provider 请求转发、计费、日志的全流程。

---

## 全链路架构图

```
HTTP Request (POST /api/gateway/ai/endpoint/v1/chat/completions)
  │  Authorization: Bearer ska_xxxx
  │  Body: { model: "claude-opus-4-7", messages: [...], stream: true }
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  第一层：全局中间件链                                              │
│  src/server/index.ts:30-107                                      │
│                                                                  │
│  requestId → secureHeaders → httpLogger → CORS                   │
│  → bodyLimit(20MB for AI) → global rateLimiter → errorHandler    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
  ┌────────────────────────────▼───────────────────────────────────┐
  │  路由注册                                                       │
  │  src/server/routes/index.ts:45-46                              │
  │                                                                │
  │  app.use("/api/gateway/ai/*", consumerKeyAuthMiddleware);      │
  │  app.route("/api/gateway/ai/endpoint", consumerRelayRouter);   │
  └────────────────────────────┬───────────────────────────────────┘
                               │
  ┌────────────────────────────▼───────────────────────────────────┐
  │  第二层：消费者 Key 认证                                         │
  │  src/server/ai/middleware/consumer-key-auth.ts:54-205           │
  │                                                                │
  │  Extract Bearer ska_ → SHA256 → DB lookup → Status checks      │
  │  → Pay-agent balance check → Set ConsumerSession               │
  └────────────────────────────┬───────────────────────────────────┘
                               │
  ┌────────────────────────────▼───────────────────────────────────┐
  │  第三层：路由处理                                                │
  │  src/server/ai/routes/consumer-relay.ts:151                    │
  │                                                                │
  │  Validate body → Model ACL → Guardrails → Resolve routes       │
  │  → Build upstream candidates → Pre-flight limits → Fetch       │
  └────────────────────────────┬───────────────────────────────────┘
                               │
  ┌────────────────────────────▼───────────────────────────────────┐
  │  第四层：上游请求执行 + 重试                                       │
  │  consumer-relay.ts:369-754                                     │
  │                                                                │
  │  Iterate upstreams (max 5) → fetch() → transform → bill        │
  │  Streaming: forwardStream() SSE pipe → async billConsumer()    │
  │  Non-streaming: parse → debitBalance() → cache → return        │
  └────────────────────────────┬───────────────────────────────────┘
                               │
  ┌────────────────────────────▼───────────────────────────────────┐
  │  第五层：异步写入（不阻塞响应）                                      │
  │  src/server/ai/index.ts:51-175                                 │
  │                                                                │
  │  enqueueJob() → agent-ai-txn / ai-usage-log / ai-request-log   │
  │  / consumer-key-touch / ai-key-touch                           │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 第一层：全局中间件链

**文件**: `src/server/index.ts:30-107`

| 顺序 | 中间件 | 说明 |
|------|--------|------|
| 1 | `requestId()` | 读取 `X-Request-ID` 头或生成 UUID，注入 AsyncLocalStorage |
| 2 | `secureHeaders()` | CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff |
| 3 | `httpLogger()` | 记录每个请求的方法、路径、状态码、耗时 |
| 4 | `cors()` | `/api/gateway/*` 对所有来源开放；管理接口仅同源 |
| 5 | `bodyLimit()` | AI 路由 20MB（支持长对话 + 扩展思考），其他路由 1MB |
| 6 | `rateLimiter()` | 全局滑动窗口限流（Redis 后端），默认规则见下 |
| 7 | error handler | 捕获 `AppError` 子类，返回结构化 JSON；未知错误返回 500 |

### 默认限流规则

| 规则 | 路径 | 限制 | 窗口 | 维度 |
|------|------|------|------|------|
| 全局 per-IP | `*` | 10,000 | 1 分钟 | IP |
| AI Gateway per-token | `/api/gateway/ai/*` | 100,000 | 1 分钟 | Token (`ska_`) |
| Auth per-IP | `/api/auth/*` | 30 | 1 分钟 | IP |
| Admin Auth per-IP | `/api/admin-auth/*` | 30 | 1 分钟 | IP |
| Admin API per-token | `/api/admin/*` | 10,000 | 1 分钟 | Token |

配置来源: `src/server/lib/gateway-config.ts:59-100`，存储在 DB `global_settings` 表，可通过 Admin → Gateway Config 调整。

---

## 第二层：消费者 Key 认证

**文件**: `src/server/ai/middleware/consumer-key-auth.ts:54-205`

### 2a. 提取 API Key (L72-85)

支持两种 header 格式（兼容 OpenAI 和 Anthropic 客户端）：

- **OpenAI 风格**: `Authorization: Bearer ska_xxxx`
- **Anthropic 风格**: `x-api-key: ska_xxxx`

两者都未提供 → `401 Unauthorized — requires a consumer API key (ska_)`

### 2b. Hash 查找 (L86-102)

```
rawKey = "ska_xxxx"
hash = SHA-256(rawKey)
→ 查询 relay_consumer_keys WHERE apiKeyHash = hash
  → 找到 → 继续
  → 未找到 → 查询 relay_consumer_key_blacklist
    → 黑名单命中 → 403 "Consumer key has been deleted"
    → 未命中 → 401 "Invalid consumer API key"
```

### 2c. 状态校验 (L105-123)

- `consumer.status !== "active"` → **403** "Consumer key is suspended"
- 所属用户 `userStatus === 2`（禁用）→ **403** "Account is disabled"
- 孤 key（`userStatus = null`）→ 放行

### 2d. 过期检查 (L126-131)

- `consumer.expiresAt` 已过 → **403** "Consumer key has expired"

### 2e. Pay-Agent 余额检查 (L133-152)

加载关联的 `pay_agents` 记录 (`consumer.agentId`)：

- agent 不存在 → **403** "Linked pay-agent not found"
- agent 状态非 active → **403** "Linked pay-agent is suspended"
- `agent.balance <= 0` → **402 Payment Required** "Agent balance exhausted. Please top up the pay-agent."

### 2f. allowedModels 解析 (L155-179)

- 解析 `consumer.allowedModels` JSON 数组
- JSON 损坏或非数组 → **500** "Consumer key configuration error"（fail-closed）
- 支持通配符: `"claude-*"` 匹配所有以 `claude-` 开头的模型

### 2g. 设置 ConsumerSession (L181-193)

注入到 Hono context：

```typescript
c.set("consumer", {
  consumerId: number;        // consumer key 的内部 ID
  userId: number | null;     // 所属用户 ID
  agentId: number;           // 关联 pay-agent ID
  agentBalance: string;      // agent 当前余额
  markupPercent: number;     // 加价比例，优先级: key.override > agent.default > global default (60s cache)
  allowedModels: string[];   // 模型 ACL，支持 * 通配符
  rateLimitRpm: number | null;
  perPayLimit: string | null;    // 单次消费上限
  dailyLimit: string | null;     // 日消费上限
  monthlyLimit: string | null;   // 月消费上限
});
```

### 认证错误日志

所有认证失败（401/403/402/500）均通过 `enqueueAiAccessLog()` 写访问日志。

---

## 第三层：路由处理 `POST /v1/chat/completions`

**文件**: `src/server/ai/routes/consumer-relay.ts:151-754`

### 3a. 请求体校验 (L178-180)

Zod schema `aiRelayChatBody` 校验: `model`（必填）, `messages`（≥1）, `stream`, `temperature`, `max_tokens` 等。失败 → **400**。

### 3b. 模型 ACL 检查 (L184-194)

```typescript
consumer.allowedModels.some(pattern => {
  if (pattern.endsWith("*")) return body.model.startsWith(pattern.slice(0, -1));
  return body.model === pattern;
});
```

不匹配 → **403** "Model X is not allowed for this key"

### 3c. 输入 Guardrails (L197-214)

加载所有 `ai_guardrail_config` 中启用的规则：

- 关键词黑名单（正则匹配）
- 单条消息长度限制
- PII 检测（邮箱/电话/SSN/信用卡）

`action = "block"` 且命中 → **403**。Guardrail 评估异常 → 记录警告后放行（不阻塞请求）。

### 3d. 模型路由解析 (L217-224)

```
aiModelRouteRepo.findEnabledRoutesByModelId(body.model)
  → JOIN ai_model_routes + ai_models + ai_providers
  → orderRoutesByPriorityAndWeight()
```

**排序算法** (`src/server/ai/lib/model-routing.ts:17-31`):

1. 按 `priority` ASC 分组
2. 组内按 `weight` 加权随机打乱（`weightedShuffle`）
3. weight=0 在同组有正 weight 时被排除

无路由 → **404** "Model X not found or disabled"

### 3e. 语义缓存检查（仅非流式，L229-233）

```
cacheKey = SHA-256(model + JSON.stringify(messages))
→ LRU 内存缓存 + Redis 后备
→ 命中 → 直接返回 JSON，不计费
```

缓存命中免费是有意设计：鼓励重用相同请求，降低系统负载。TTL: 5 分钟，容量: 10,000 条。

### 3f. 上游候选组装 (L238-321)

对每个 route（按 priority 顺序），对每个 provider，对每个 upstream：

```
for (const { route, provider, model } of routes) {
  adapter = getAdapter(provider.apiFormat)
  // openai / anthropic / gemini / azure-openai / bedrock

  transformedBody = adapter.transformRequest({
    ...body,
    model: route.providerModelId ?? model.modelId,
    stream_options: body.stream ? { include_usage: true } : {},
  });

  for (const upstream of resolveUpstreamCandidates(provider)) {
    key = await pickKey(provider.id, upstream.id);     // 内存 SWRR
    if (!key) continue;

    plainKey = decrypt(key.encryptedKey, "ai-merchant-key");  // AES-256-GCM
    mappedModelId = await resolveModelMapping(upstream.id, providerModelId);  // 30s cache
    upstreamUrl = adapter.buildUrl(upstream.baseUrl, { model, stream });
    auth = buildProviderAuth(provider, plainKey, upstreamUrl, body);
  }
}
```

返回 `ResolvedUpstream[]`，空 → **403** "No API key configured for any provider route"

### 3g. 预检限额（L332-363）

- `dailyLimit` 已超标 → **429** "Daily spending limit exceeded"
- `monthlyLimit` 已超标 → **429** "Monthly spending limit exceeded"

查询 `pay_agent_transactions` 表中当日/当月的 `SUM(amount)`。

---

## 第四层：上游请求执行与重试

**文件**: `src/server/ai/routes/consumer-relay.ts:369-754`

### 重试策略

- 最多尝试 `MAX_UPSTREAM_ATTEMPTS = 5` 个候选上游
- 可重试状态码: `{429, 500, 502, 503, 504}`
- 不可重试 (400, 401, 403 等) → 立即返回错误给客户端
- 每个候选失败时调用 `markKeyFailure()` 施加惩罚
- 全部候选耗尽 → **502** "All upstream candidates failed"

### 流式路径 (L388-456)

```
fetchUpstream(url, headers, body, timeout)
  → if !ok && retryable → markKeyFailure(), continue
  → if ok:
      forwardStream(c, upstreamRes, adapter, meta, onComplete, timeouts)
        → SSE headers 已发送（不可回退重试）
        → 逐帧解析 SSE 事件
        → adapter.transformStreamEvent() 转码
        → 累加 token 用量
        → 心跳: 15s interval
        → 空闲超时: 5min (STREAM_IDLE_TIMEOUT_MS)
        → 最大时长: 30min (STREAM_MAX_DURATION_MS)
        → 缓冲区上限: 1MB (MAX_BUFFER_SIZE)
        → 流结束时:
            onComplete(usage, latencyMs, rawResponse)
              → billConsumer() 异步扣费
```

流式计费在响应已发送后执行 — 若扣费失败，agent 自动挂起。

### 非流式路径 (L460-731)

```
fetch(url, { body, headers, signal: AbortSignal.timeout(streamMaxDurationMs) })
  → if !ok && retryable → markKeyFailure(), continue
  → if ok:
      responseBody = await upstreamRes.json()
      transformed = adapter.transformResponse(responseBody)
      usage = adapter.extractUsage(responseBody)
      markKeySuccess(keyId)

      // 计费
      upstreamCost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1,000,000
      consumerCost = upstreamCost * (1 + markupPercent / 100)

      // 限额检查
      if perPayLimit exceeded → 429
      if dailyLimit would exceed → 429
      if monthlyLimit would exceed → 429

      // 原子扣款
      debited = await payAgentRepo.debitBalance(agentId, consumerCost)
      // SQL: UPDATE pay_agents SET balance = balance - cost WHERE id = X AND balance >= cost

      if !debited:
        await payAgentRepo.update(agentId, { status: "suspended" })
        emit("agent.suspended", null, { agentId })
        return 402

      // 异步写入
      enqueueJob("agent-ai-txn", { ... })
      enqueueJob("ai-usage-log", { ... })
      enqueueJob("ai-request-log", { ... })  // 按配置
      enqueueJob("consumer-key-touch", { consumerId })
      enqueueJob("ai-key-touch", { keyId })

      // 写语义缓存
      setCachedResponse(cacheKey, transformed)

      // 返回
      return c.json(transformed)
```

### 通用 Passthrough `ALL /v1/*` (L758-1056)

处理其他端点（如 `/v1/messages`, `/v1/embeddings` 等）。与 chat completions 流程相同但不经过 adapter 转换 — 直接透传请求体到上游。同样包含计费、重试、流式/非流式分支。

---

## 上游路由解析

**文件**: `src/server/ai/lib/upstream-routing.ts:92-134`

### 缓存机制

- 30s TTL 内存缓存（`upstreamCache` Map，key 为 provider PK）
- `invalidateUpstreamCache(providerId)` 在 CRUD 操作后调用
- `invalidateUpstreamCacheForUpstream(upstreamId)` 在全局 upstream 变更时调用

### 候选来源

1. `aiUpstreamAssignmentRepo.findEnabledByProviderId(provider.id)`
   → JOIN `ai_upstream_assignments` + `ai_upstreams`（仅 enabled）
2. 始终追加 legacy target: provider 自身的 `baseUrl`，priority=1000

### 排序策略

- `upstreamRoutingStrategy === "weighted-random"` → `weightedShuffle` 加权随机
- 否则 → `priority ASC, weight DESC, name ASC` 稳定排序

---

## Key 负载均衡器

**文件**: `src/server/ai/lib/key-balancer.ts`

### 两种策略

| 策略 | 算法 | 默认 |
|------|------|------|
| `round-robin` | Smooth Weighted Round-Robin (Nginx 风格) | ✅ |
| `random` | 加权随机概率选择 | |

由 provider 的 `loadBalanceStrategy` 列配置。

### SWRR 算法细节 (L123-143)

```
每次调用:
1. 每个 entry.currentWeight += entry.effectiveWeight
2. 选出 currentWeight 最大的 entry
3. 选中的 entry.currentWeight -= totalEffectiveWeight
```

效果: 按权重比例均匀分布，最小化聚类。

### 内存健康追踪

```typescript
interface KeyHealth {
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: number | null;
  penaltyUntil: number;
}
```

### 惩罚机制 (L250-260)

```typescript
markKeyFailure(keyId):
  consecutiveFailures++
  penaltyMs = min(BASE_PENALTY_MS * 2^(consecutiveFailures - 1), MAX_PENALTY_MS)
  // BASE_PENALTY_MS = 30s, MAX_PENALTY_MS = 2min
  penaltyUntil = now + penaltyMs

getEffectiveWeight():
  if penaltyUntil > now:
    return max(1, floor(weight / (consecutiveFailures + 1)))
  return weight
```

成功恢复 (`markKeySuccess`): 重置 consecutiveFailures 和 penalty→ 立即恢复正常权重。

---

## Provider Auth 构建

**文件**: `src/server/ai/lib/provider-auth.ts:38-96`

| Auth 类型 | 输出 | 来源 |
|-----------|------|------|
| `bearer` | `Authorization: Bearer <key>` | OpenAI 等 |
| `api-key` | 自定义 header（默认 `x-api-key`），可从 `authConfig.headerName` 配置 | Anthropic 等 |
| `sigv4` | `Authorization: AWS4-HMAC-SHA256 ...`, `X-Amz-Date`, `X-Amz-Content-Sha256` | AWS Bedrock |
| `gemini` | `?key=<key>` query 参数（不设 Authorization header） | Google Gemini |

### 特殊处理

- **Anthropic / Bedrock**: 额外注入 `anthropic-version: 2023-06-01`
- **SigV4**: 使用 Node.js `crypto.createHmac("sha256")` 计算 AWS 签名

---

## 计费管道

**文件**: `src/server/ai/lib/billing.ts:75-162`

### 成本计算

```
upstreamCost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1,000,000
consumerCost = upstreamCost * (1 + markupPercent / 100)
```

价格按百万 token 计，存储为 `ai_models.inputPrice/outputPrice`（string 类型，BigNumber 精度）。

### Markup 优先级

```
consumer.markupPercent > agent.defaultMarkupPercent > global setting "ai_default_markup"
```

全局默认值有 60s 缓存 (`consumer-key-auth.ts:23-33`)。

### 扣款 SQL

```sql
UPDATE pay_agents
SET balance = balance - $cost, updated_at = NOW()
WHERE id = $agentId AND balance >= $cost
RETURNING id, balance, status
```

原子操作 — 如果余额不足，UPDATE 不匹配任何行，返回 undefined。

### 扣费失败处理

- agent 状态 → `suspended`
- 发射 `agent.suspended` 事件（SSE 通知管理端）
- 返回 402（非流式）；流式则静默记录（响应已发送）

---

## Key Provider 分润

**文件**: `src/server/ai/index.ts:130-165`

当 AI key 有 `ownerId`（key provider）且 provider 为 active 时：

```
platformProfit = consumerCost - upstreamCost
share = platformProfit * provider.revenueSharePercent / 100
```

分成计入 key provider 的余额（`key_providers.balance`），并记录交易流水。

---

## 异步写入系统

**文件**: `src/server/ai/index.ts:51-175`

所有计费和日志通过 `enqueueJob()` 异步处理，不阻塞 HTTP 响应。

| Job 名称 | 处理方式 | 内容 |
|----------|---------|------|
| `agent-ai-txn` | write handler | 交易记录 + Key Provider 分润 |
| `ai-usage-log` | **batch handler** (50条/1s) | 用量日志批量 INSERT |
| `ai-request-log` | write handler（按开关） | 请求/响应体日志 |
| `consumer-key-touch` | write handler | 更新 `relay_consumer_keys.last_used_at` |
| `ai-key-touch` | write handler | 更新 `ai_keys.last_used_at` |

降级: Redis 不可用时静默丢弃 + 节流告警。

---

## 流式传输参数

**文件**: `src/server/ai/lib/stream-proxy.ts`

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `STREAM_IDLE_TIMEOUT_MS` | 300,000 (5min) | 上游无数据传输则中断 |
| `STREAM_MAX_DURATION_MS` | 1,800,000 (30min) | 流式传输硬上限 |
| `HEARTBEAT_INTERVAL_MS` | 15,000 (15s) | SSE 心跳间隔（防止代理断连） |
| `MAX_BUFFER_SIZE` | 1,048,576 (1MB) | SSE 缓冲区溢出保护 |
| `upstreamFetchMs` | 120,000 (120s) | 等待上游首字节（含思考模型） |

超时配置可通过 Admin → Gateway Config 调整，存储在 `global_settings` 表。

---

## 流式 vs 非流式差异

| 方面 | 流式 | 非流式 |
|------|------|--------|
| 响应方式 | SSE 逐帧转发 | 一次性 JSON |
| 计费时机 | 流结束后异步（响应已发送，不可回退） | 响应前同步（可拒绝） |
| 单次限额 | 流后检查，超限挂起 Agent | 响应前检查，超限返回 429 |
| 日/月限额 | 仅预检 | 预检 + 响应前二次检查（含本次消费） |
| 语义缓存 | 不参与 | 读 + 写 |
| 超时 | 空闲 5min + 硬限 30min + 心跳 15s | 单一 AbortSignal.timeout(30min) |

---

## 核心数据表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `relay_consumer_keys` | 消费者 API Key | hash, agentId, allowedModels, markupPercent, expiresAt, rateLimitRpm |
| `relay_consumer_key_blacklist` | 已删除 Key 防重放 | apiKeyHash |
| `pay_agents` | 钱包/余额账户 | balance, perPayLimit, dailyLimit, monthlyLimit, defaultMarkupPercent |
| `pay_agent_transactions` | 交易流水 | agentId, amount, consumerKeyId, modelId, tokens, upstreamCost |
| `ai_models` | 模型目录 | modelId, inputPrice, outputPrice, fallbackModelIds |
| `ai_model_routes` | 模型→Provider 路由 | modelId, providerId, providerModelId, priority, weight |
| `ai_providers` | Provider 配置 | apiFormat, authType, baseUrl, loadBalanceStrategy, upstreamRoutingStrategy |
| `ai_keys` | 上游 API Key（加密存储） | encryptedKey, weight, upstreamId, ownerId |
| `ai_upstreams` | 上游端点 | baseUrl, kind (official/reseller/custom), modelsEndpoint |
| `ai_upstream_assignments` | Provider↔Upstream N:N | providerId, upstreamId, priority, weight |
| `ai_upstream_model_mappings` | 模型名重映射 | upstreamId, sourceModelId, mappedModelId |
| `ai_guardrail_config` | 内容审核规则 | rules (JSON), action (warn/block) |

---

## Provider 适配器

| 适配器 | apiFormat | 文件 |
|--------|-----------|------|
| OpenAI | `openai` | `src/server/ai/providers/openai.ts` |
| Anthropic | `anthropic` | `src/server/ai/providers/anthropic.ts` |
| Gemini | `gemini` | `src/server/ai/providers/gemini.ts` |
| Azure OpenAI | `azure-openai` | `src/server/ai/providers/azure-openai.ts` |
| AWS Bedrock | `bedrock` | `src/server/ai/providers/bedrock.ts` |

每个适配器实现: `transformRequest`, `transformResponse`, `extractUsage`, `transformStreamEvent`, `extractStreamUsage`, `isStreamDone`, `buildUrl`。

---

## 一条请求的大致时间线

```
t=0ms   全局中间件链 (requestId, CORS, rate limiter...)
t=1ms   认证: SHA256(key) → DB lookup → status/expiry/balance checks
t=5ms   路由: Zod 校验 body → ACL 检查 → guardrails → model routing
t=10ms  上游组装: resolveUpstreamCandidates → pickKey (内存 SWRR)
         → decrypt key → resolveModelMapping (30s cache) → buildProviderAuth
t=12ms  预检 daily/monthly 限额
t=15ms  fetch(upstreamUrl) 发出上游请求
t=?     上游响应 → transformResponse → extractUsage
t=?+1   计费: calculateConsumerCost → debitBalance (原子 SQL)
t=?+2   enqueueJob(日志 + 交易 + touch) → 返回 JSON/SSE 给客户端
```

---

## 关键设计决策

1. **两层标识隔离**: 外部 `uuid` 在路由边界解析为内部 `id`，下游逻辑统一用内部 `id`
2. **非阻塞写**: 计费日志/交易记录/Key touch 全部通过 `enqueueJob` 异步写入，响应时间不受 DB 延迟影响
3. **内存 Key 池**: 绕过 DB 的 LRU 竞争条件，用内存 SWRR 同步轮转；健康追踪带指数退避惩罚
4. **缓存命中免费**: 语义缓存命中不计费，鼓励客户端重用相同请求
5. **流式不可回退**: SSE headers 发送后即无法重试，失败仅记录
6. **安全 Fail-Closed**: allowedModels JSON 损坏 → 500 拒绝；guardrails 异常 → 警告后放行
7. **Markup 三层优先级**: per-key override > agent default > global setting，60s 缓存 global 默认值
