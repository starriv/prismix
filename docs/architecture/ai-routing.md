# AI 路由架构

用户请求从网关到上游的完整路由流程。

## 三层解析

```
                        用户请求
                        model = "claude-opus-4-7"
                              │
        ┌─────────────────────┴─────────────────────┐
        │         第一层：模型路由                      │
        │        (模型 × 端点)                         │
        │                                            │
        │  ai_model_routes                           │
        │  ┌──────────────────────────────────────┐  │
        │  │ modelId: claude-opus-4-7             │  │
        │  │ endpointId: Anthropic (id=7)         │  │
        │  │ endpointModelId: null (使用原名)       │  │
        │  │ priority: 100, weight: 1             │  │
        │  └──────────────────────────────────────┘  │
        │                                            │
        │  决定：哪个端点处理这个模型。                    │
        │  可选的 endpointModelId 在路由级覆盖模型名。    │
        │                                            │
        │  输出: endpointModelId =                    │
        │    route.endpointModelId ?? model.modelId  │
        └─────────────────────┬─────────────────────┘
                              │
                    endpointModelId = "claude-opus-4-7"
                              │
        ┌─────────────────────┴─────────────────────┐
        │         第二层：上游路由                       │
        │       (端点 × 上游)                          │
        │                                            │
        │  ai_upstream_assignments                   │
        │  ┌──────────────────────────────────────┐  │
        │  │ endpointId: Anthropic (id=7)         │  │
        │  │ upstreamId: 官方 (id=1)               │  │
        │  │ priority: 100, weight: 1             │  │
        │  ├──────────────────────────────────────┤  │
        │  │ endpointId: Anthropic (id=7)         │  │
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
        │  无映射则原样透传 endpointModelId。            │
        │                                            │
        │  输出: effectiveModelId =                   │
        │    mapping[endpointModelId]                 │
        │    ?? endpointModelId                      │
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
        │  Auth: x-api-key (从 ai_credentials 解密)   │
        └────────────────────────────────────────────┘
```

## 解析优先级

```
effectiveModelId = upstream_mapping[endpointModelId]    -- 第三层：上游映射
                 ?? route.endpointModelId               -- 第一层：路由覆盖
                 ?? model.modelId                       -- 默认：原始模型名
```

## 涉及的表

| 表                           | 作用                    | 关键字段                                                         |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `ai_suppliers`               | 供应商（真实厂商）      | `supplierId`, `name`, `enabled`                                  |
| `ai_models`                  | 模型目录                | `modelId`, `enabled`                                             |
| `ai_model_routes`            | 模型 → 端点路由         | `modelId`, `endpointId`, `endpointModelId`, `priority`, `weight` |
| `ai_endpoints`               | 协议端点配置            | `supplierId`, `apiFormat`, `authType`, `baseUrl`                 |
| `ai_upstream_assignments`    | 端点 → 上游绑定         | `endpointId`, `upstreamId`, `priority`, `weight`                 |
| `ai_upstreams`               | 上游服务器              | `baseUrl`, `modelsEndpoint`, `kind`                              |
| `ai_upstream_model_mappings` | 上游级模型 ID 覆盖      | `upstreamId`, `sourceModelId`, `mappedModelId`                   |
| `ai_credentials`             | API 凭证（加密存储）    | `supplierId`, `ownerId`, `encryptedKey`, `keyHash`               |
| `ai_endpoint_credentials`    | 凭证按端点/上游范围绑定 | `endpointId`, `upstreamId`, `credentialId`, `weight`             |

## 缓存

| 缓存     | 键                      | TTL   | 失效时机             |
| -------- | ----------------------- | ----- | -------------------- |
| 上游路由 | `endpointId`            | 30 秒 | 分配/上游增删改      |
| 模型映射 | `upstreamId`            | 30 秒 | 映射增删改、上游删除 |
| 凭证池   | `endpointId:upstreamId` | 按需  | 凭证增删改、上游变更 |

## 容错

1. **模型路由容错**：主端点失败（429/5xx）时，按 priority 尝试下一条路由。支持跨模型 fallback（`fallbackModelIds`）。
2. **上游容错**：同一端点内，某个上游失败则尝试下一个（按 priority/weight）。
3. **最大尝试次数**：所有候选合计 `MAX_UPSTREAM_ATTEMPTS = 5`。

## 管理入口

| 配置项           | 管理位置                                       |
| ---------------- | ---------------------------------------------- |
| 模型 → 端点路由  | AI Models → 选择模型 → Routes 面板             |
| 路由级模型名覆盖 | Routes 面板 → Endpoint Model ID 字段           |
| 端点 → 上游绑定  | AI Endpoints → 选择端点 → Upstreams 标签       |
| 上游级模型映射   | AI Upstreams → 选择上游 → Model Mappings 卡片  |
| 上游模型发现端点 | AI Upstreams → 编辑上游 → Models Endpoint 字段 |
