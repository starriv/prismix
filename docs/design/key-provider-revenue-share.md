# Key Provider Revenue Share — 密钥合作方分润系统

## 概述

允许第三方（密钥合作方）向平台提供 AI API 凭证，平台使用这些凭证为消费者提供服务，合作方按实际用量赚取分润收益。

## 核心思路

现有 `ai_credentials` 表已经形成一个统一凭证池，`credential-balancer` 按 weight 做负载均衡选凭证。改动只需：

1. 给 `ai_credentials` 加 `ownerId` 标记"这把凭证是谁的"
2. 新增 `key_providers` 表存储合作方信息和待结算余额
3. 在**已有的异步写入队列**里追加分润计算逻辑（不动热路径）

## 架构示意

```
Key Provider (朋友)
  │
  ├── 提供 OpenAI 凭证 ×3 (weight=1 each)
  ├── 提供 Anthropic 凭证 ×2
  │
  ▼
ai_credentials 表 (混合池)
  ├── credential#1  ownerId=NULL   weight=2  (平台自有)
  ├── credential#2  ownerId=1      weight=1  (合作方#1)
  ├── credential#3  ownerId=1      weight=1  (合作方#1)
  ├── credential#4  ownerId=NULL   weight=1  (平台自有)
  │
  ▼
credential-balancer (SWRR, 按 weight 均匀分配, 零改动)
  │
  ▼
Consumer 请求 → 选中 credential#3 → upstream AI → 响应
  │
  ▼
billConsumer() → debit consumer (零改动)
  │
  ▼
async write queue (已有, 仅追加分润步骤):
  ├── ai_usage_logs       (已有, 不改)
  ├── pay_agent_txns      (已有, 不改)
  └── NEW: key_provider 分润
       upstreamCost   = $0.002 (token × model price)
       consumerCost   = $0.003 (upstream × (1 + markup%))
       platformProfit = $0.001 (consumer - upstream)
       providerShare  = $0.001 × 70% = $0.0007
       → creditBalance(合作方#1, $0.0007)
       → insert key_provider_transactions
```

## 不改的部分（关键）

| 模块                     | 为什么不改                                          |
| ------------------------ | --------------------------------------------------- |
| `credential-balancer.ts` | 只按 weight 选凭证，不关心 owner                    |
| `consumer-relay.ts`      | 请求转发逻辑不变                                    |
| `billConsumer()`         | 扣费逻辑不变，payload 里已有 `endpointCredentialId` |
| `consumer-key-auth.ts`   | 认证逻辑不变                                        |
| `endpoint-auth.ts`       | 上游认证不变                                        |

## 数据模型

### 新增表: `key_providers`

密钥合作方信息 + 待结算余额。管理表，FK + CASCADE。

```ts
export const keyProviders = pgTable("key_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  contactInfo: text("contact_info"), // 联系方式 (自由文本)
  address: text("address"), // 钱包地址 (提现用)
  revenueSharePercent: real("revenue_share_percent").notNull().default(70), // 分润比例 (%)
  balance: text("balance").notNull().default("0"), // 待结算余额
  status: text("status").notNull().default("active"), // active | suspended
  updatedAt: timestamp("updated_at"),
  createdAt: timestamp("created_at"),
});
```

### 新增表: `key_provider_transactions`

分润流水。高频追加，**no FK**。

```ts
export const keyProviderTransactions = pgTable("key_provider_transactions", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull(), // no FK
  credentialId: integer("credential_id"), // which ai_credential earned this
  type: text("type").notNull(), // revenue_share | withdraw | adjustment
  amount: text("amount").notNull(),
  balanceBefore: text("balance_before").notNull(),
  balanceAfter: text("balance_after").notNull(),
  description: text("description"),
  requestId: text("request_id"), // 关联 ai_usage_logs
  createdAt: timestamp("created_at"),
});
```

### 修改表: `ai_credentials`

```ts
// 新增列
ownerId: integer("owner_id").references(() => keyProviders.id, { onDelete: "set null" }),
```

## 分润计算公式

```
upstreamCost   = (inputTokens × inputPrice + outputTokens × outputPrice) / 1,000,000
consumerCost   = upstreamCost × (1 + markupPercent / 100)
platformProfit = consumerCost - upstreamCost
providerShare  = platformProfit × (revenueSharePercent / 100)
```

- `revenueSharePercent` 从 `key_providers` 表读取
- 合作方分到的是 **markup 利润的一部分**，不是 upstreamCost
- 分润在 async write queue 中计算，不影响请求延迟

## API 端点

### Admin CRUD (`/api/admin/key-providers`)

| Method | Path                                        | 说明                              |
| ------ | ------------------------------------------- | --------------------------------- |
| GET    | `/api/admin/key-providers`                  | 列表 (分页)                       |
| GET    | `/api/admin/key-providers/:id`              | 详情 (含关联凭证数量、总收益)     |
| POST   | `/api/admin/key-providers`                  | 创建合作方                        |
| PUT    | `/api/admin/key-providers/:id`              | 编辑 (名称、分润比例、状态)       |
| DELETE | `/api/admin/key-providers/:id`              | 删除 (关联凭证的 ownerId 置 NULL) |
| GET    | `/api/admin/key-providers/:id/transactions` | 分润流水 (分页)                   |
| POST   | `/api/admin/key-providers/:id/adjust`       | 手动调账 (加减余额)               |

### AI 凭证扩展

- `POST /api/admin/ai/credentials` — 创建时可选 `ownerId`
- `PUT /api/admin/ai/credentials/:id` — 编辑时可改 `ownerId`

## Web UI

### Admin 页面: Key Providers 管理

- 列表页: 合作方名称、分润比例、余额、状态、关联 key 数量
- Detail Sheet: Hero Card (余额 + 状态) + 基本信息 + 分润配置 + 关联 Keys 列表 + 交易历史
- 创建/编辑 Dialog

### AI 凭证页面扩展

- 创建/编辑表单新增 "Owner" Select (可选, 从 key_providers 列表选)
- 列表表格新增 "Owner" 列 (Badge 显示合作方名称)

## 实现步骤

### Phase 1: DB + Repo

1. `pg.ts` 新增 `keyProviders` + `keyProviderTransactions` 表
2. `ai_credentials` 新增 `ownerId` 列
3. `key-provider-repo.ts` — CRUD + `creditBalance` + `debitBalance`
4. `key-provider-transaction-repo.ts` — insert + list
5. `db:generate` 生成 migration
6. 更新 repos barrel export

### Phase 2: 分润逻辑

7. `src/server/ai/index.ts` 的 async write handler 追加分润计算
8. 当 `ai_usage_logs` 写入时，检查 `credentialId` 对应的 `ai_credentials.ownerId`
9. 有 owner → 计算分润 → `creditBalance` + insert transaction

### Phase 3: Admin API

10. `src/server/admin/routes/key-providers.ts` — CRUD routes
11. 扩展 `ai-credentials` 相关 route 支持 `ownerId`
12. 注册路由到 `routes/index.ts`

### Phase 4: Web UI

13. API layer: schemas + hooks + constants + query-keys
14. Admin Key Providers 列表页
15. Admin Key Providers Detail Sheet
16. Admin Key Providers 创建/编辑 Dialog
17. AI 凭证表单/列表扩展 owner 字段

### Phase 5: i18n + 测试

18. en.json + zh.json 新增所有 i18n key
19. Unit tests: repo + 分润计算
20. E2E tests: admin key providers 页面

## 未来扩展

| 能力                | 实现方式                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| 合作方自助注册      | `key_providers` 关联 `users` 表，用户自行上传凭证                       |
| 按 model 差异化分润 | 分润公式加 model 权重系数                                               |
| 合作方 dashboard    | 复用 `ai_usage_logs` + `WHERE credentialId IN (合作方的 credentials)`   |
| 自动结算/提现       | 复用已有 `withdraw_orders` 流程                                         |
| 凭证质量监控        | `ai_usage_logs` 已有 `statusCode` + `latencyMs`，按 `credentialId` 聚合 |
| 合作方限流          | 在 credential-balancer 层面根据 ownerId 做额外 rate-limit               |
