# AI 路由架构

用户请求从网关到上游供应商的完整路由流程。

## 三层解析

```
                        用户请求
                        model = "claude-opus-4-7"
                              │
        ┌─────────────────────┴─────────────────────┐
        │         第一层：模型路由                      │
        │        (模型 × 供应商)                       │
        │                                            │
        │  ai_model_routes                           │
        │  ┌──────────────────────────────────────┐  │
        │  │ modelId: claude-opus-4-7             │  │
        │  │ providerId: Anthropic (id=7)         │  │
        │  │ providerModelId: null (使用原名)       │  │
        │  │ priority: 100, weight: 1             │  │
        │  └──────────────────────────────────────┘  │
        │                                            │
        │  决定：哪个供应商处理这个模型。                  │
        │  可选的 providerModelId 在路由级覆盖模型名。    │
        │                                            │
        │  输出: providerModelId =                    │
        │    route.providerModelId ?? model.modelId  │
        └─────────────────────┬─────────────────────┘
                              │
                   providerModelId = "claude-opus-4-7"
                              │
        ┌─────────────────────┴─────────────────────┐
        │         第二层：上游路由                       │
        │       (供应商 × 上游)                        │
        │                                            │
        │  ai_upstream_assignments                   │
        │  ┌──────────────────────────────────────┐  │
        │  │ providerId: Anthropic (id=7)         │  │
        │  │ upstreamId: 官方 (id=1)               │  │
        │  │ priority: 100, weight: 1             │  │
        │  ├──────────────────────────────────────┤  │
        │  │ providerId: Anthropic (id=7)         │  │
        │  │ upstreamId: 第三方代理 (id=2)          │  │
        │  │ priority: 200, weight: 1             │  │
        │  └──────────────────────────────────────┘  │
        │                                            │
        │  决定：请求发到哪个上游服务器。                  │
        │  按 priority 排序，同优先级内按 weight 加权随机。│
        │                                            │
        │  输出: upstream (baseUrl, id, ...)          │
        └─────────────────────┬─────────────────────┘
                              │
                    upstream = 第三方代理 (id=2)
                              │
        ┌─────────────────────┴─────────────────────┐
        │         第三层：模型映射                       │
        │       (按上游覆盖模型名)                      │
        │                                            │
        │  ai_upstream_model_mappings                │
        │  ┌──────────────────────────────────────┐  │
        │  │ upstreamId: 2 (第三方代理)             │  │
        │  │ sourceModelId: "claude-opus-4-7"     │  │
        │  │ mappedModelId: "kiro/opus04.7"       │  │
        │  │ enabled: true                        │  │
        │  └──────────────────────────────────────┘  │
        │                                            │
        │  决定：发给这个上游的实际模型 ID。              │
        │  无映射则原样透传 providerModelId。            │
        │                                            │
        │  输出: effectiveModelId =                   │
        │    mapping[providerModelId]                 │
        │    ?? providerModelId                      │
        └─────────────────────┬─────────────────────┘
                              │
                   effectiveModelId = "kiro/opus04.7"
                              │
        ┌─────────────────────┴─────────────────────┐
        │              上游请求                        │
        │                                            │
        │  POST https://third-party.example.com/     │
        │       v1/messages                          │
        │  Body: { model: "kiro/opus04.7", ... }     │
        │  Auth: x-api-key (从 ai_keys 解密)          │
        └────────────────────────────────────────────┘
```

## 解析优先级

```
effectiveModelId = upstream_mapping[providerModelId]     -- 第三层：上游映射
                 ?? route.providerModelId                -- 第一层：路由覆盖
                 ?? model.modelId                        -- 默认：原始模型名
```

## 涉及的表

| 表                           | 作用                           | 关键字段                                                         |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `ai_models`                  | 模型目录                       | `modelId`, `enabled`                                             |
| `ai_model_routes`            | 模型 → 供应商路由              | `modelId`, `providerId`, `providerModelId`, `priority`, `weight` |
| `ai_providers`               | 供应商配置                     | `apiFormat`, `authType`, `baseUrl`                               |
| `ai_upstream_assignments`    | 供应商 → 上游绑定              | `providerId`, `upstreamId`, `priority`, `weight`                 |
| `ai_upstreams`               | 上游服务器                     | `baseUrl`, `modelsEndpoint`, `kind`                              |
| `ai_upstream_model_mappings` | 上游级模型 ID 覆盖             | `upstreamId`, `sourceModelId`, `mappedModelId`                   |
| `ai_keys`                    | API 密钥（按供应商或上游范围） | `providerId`, `upstreamId`, `encryptedKey`                       |

## 缓存

| 缓存     | 键           | TTL   | 失效时机             |
| -------- | ------------ | ----- | -------------------- |
| 上游路由 | `providerId` | 30 秒 | 分配/上游增删改      |
| 模型映射 | `upstreamId` | 30 秒 | 映射增删改、上游删除 |
| 密钥池   | `providerId` | 按需  | 密钥增删改、上游变更 |

## 容错

1. **模型路由容错**：主供应商失败（429/5xx）时，按 priority 尝试下一条路由。支持跨模型 fallback（`fallbackModelIds`）。
2. **上游容错**：同一供应商内，某个上游失败则尝试下一个（按 priority/weight）。
3. **最大尝试次数**：所有候选合计 `MAX_UPSTREAM_ATTEMPTS = 5`。

## 管理入口

| 配置项            | 管理位置                                       |
| ----------------- | ---------------------------------------------- |
| 模型 → 供应商路由 | AI Models → 选择模型 → Routes 面板             |
| 路由级模型名覆盖  | Routes 面板 → Provider Model ID 字段           |
| 供应商 → 上游绑定 | AI Providers → 选择供应商 → Upstreams 标签     |
| 上游级模型映射    | AI Upstreams → 选择上游 → Model Mappings 卡片  |
| 上游模型发现端点  | AI Upstreams → 编辑上游 → Models Endpoint 字段 |
