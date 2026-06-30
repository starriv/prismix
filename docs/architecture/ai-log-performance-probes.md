# AI 日志性能探测指标

AI 网关在 `ai_usage_logs` 中记录请求级性能探测字段，用于解释慢请求、流式首包、缓存效果、重试和计费耗时。指标由 `src/server/ai/lib/performance-probe.ts` 统一归一化，缺失值保持为 `null`，旧日志行不会被补假数据。

## 请求类型字段

| 字段           | 语义                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| `routeType`    | `chat` 或 `passthrough`，表示请求来自标准 chat completions 处理还是通用 `/v1/*` 透传。 |
| `isStream`     | 请求是否以 SSE 流式返回。                                                              |
| `cacheStatus`  | 网关语义缓存状态：`hit`、`miss`、`bypass`、`disabled`。                                |
| `attemptCount` | 已尝试的上游候选次数，包含第一次尝试。                                                 |
| `retryCount`   | 重试次数，不包含第一次尝试，等于额外尝试的上游候选数。                                 |

## 延迟字段

所有 `*Ms` 字段单位都是毫秒，并在写入前四舍五入为非负整数。

| 字段             | 起止点                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `latencyMs`      | 请求进入当前 relay 处理到响应完成；流式请求为 stream 完成时刻。                                                    |
| `routingMs`      | 解析模型、路由、上游候选和凭证池的耗时。                                                                           |
| `cacheLookupMs`  | 网关语义缓存查找耗时。                                                                                             |
| `cacheWriteMs`   | 网关语义缓存写入耗时。                                                                                             |
| `queueWaitMs`    | 进入上游并发队列到实际获得执行权的等待耗时。                                                                       |
| `upstreamTtfbMs` | 开始发起上游请求到收到上游响应头的耗时；缓存命中或未触达上游时为空。                                               |
| `upstreamBodyMs` | 收到上游响应头后，读取完整非流式响应体的耗时。                                                                     |
| `transformMs`    | 网关完成协议转换、响应格式转换、token usage 提取等本地处理的耗时。                                                 |
| `billingMs`      | 消费者扣费、交易记录、使用日志入队等计费相关操作耗时。非流式路径会计入用户可见延迟；流式路径在完成回调中异步记录。 |
| `firstChunkMs`   | 流式请求从 relay 开始处理到收到第一个上游 chunk 的耗时。                                                           |
| `firstTokenMs`   | 首 token 近似耗时。当前实现与 `firstChunkMs` 同源，保留独立字段以便未来接入协议级 token 事件。                     |

## 大小和流式字段

| 字段                | 语义                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestBytes`      | relay 发送到上游或缓存处理的 JSON 请求体 UTF-8 字节数。                                                                                        |
| `responseBytes`     | 非流式响应体字节数；流式请求若启用请求日志则为捕获响应文本字节数，否则使用上游 chunk 总字节数。                                                |
| `streamChunks`      | relay 从上游读取到的流式 chunk 数。                                                                                                            |
| `streamBytes`       | relay 从上游读取到的流式 chunk 总字节数。                                                                                                      |
| `streamPingCount`   | 流式上游事件中识别到的 `ping` 事件数量。                                                                                                       |
| `streamAbortReason` | 流式结束原因：`completed`、`client_abort`、`idle_timeout`、`max_duration`、`buffer_overflow`、`upstream_read_error`、`upstream_missing_body`。 |

## 缓存口径

网关语义缓存和供应商 prompt cache 是两套不同指标：

- `cacheStatus` 描述 Prismix 网关自己的语义缓存是否命中、未命中、绕过或关闭。
- `cacheReadInputTokens` 和 `cacheCreationInputTokens` 来自供应商 usage 字段，表示供应商 prompt cache 的读写 token。
- 聚合 cache hit rate 的分母只统计 `hit` 和 `miss`，不把 `bypass` 或 `disabled` 计入命中率分母。
- prompt cache read/write rate 使用供应商 cache token 除以输入 token 总量计算，不从 `cacheStatus` 推断。

## 计费语义

- 消费者语义缓存命中会写入一条零成本 usage log，用于运营统计和命中率聚合，不会重复扣费。
- 非缓存上游响应仍按原有 usage/cost 逻辑计费，新增性能字段只随日志写入。
- 管理端 relay 没有消费者余额扣费，缓存命中只记录估算成本和诊断字段。
- 流式消费者扣费仍在 stream 完成回调中执行；回调会收到同一份 stream 性能快照，避免日志和计费路径的指标口径分叉。
