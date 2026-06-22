# Prismix

## 中文

### 项目介绍

Prismix 是一个 AI 网关和计费后台。它把用户请求转发到不同的 AI 供应商，同时管理模型路由、上游密钥、消费者密钥、余额、用量日志、通知和 Webhook。

适合的场景：

- 用一个统一入口接入 OpenAI、Anthropic、Gemini、Azure、Bedrock 或兼容 OpenAI 协议的上游。
- 给用户发放 `ska_` 开头的消费者密钥，并限制可用模型、频率和消费额度。
- 按请求记录用量和成本，基于 Pay Agent 余额扣费。
- 在后台管理模型、供应商、上游、密钥、用户、充值、提现、通知和系统配置。

### 技术原理

Prismix 分为前端、API 服务、数据库和 Redis 四部分。

- 前端使用 React、Vite、React Router、TanStack Query 和 Tailwind CSS，提供管理后台、用户后台和公开文档页。
- API 使用 Hono 跑在 Node.js 上，生产环境同时提供 API 和打包后的前端页面。
- PostgreSQL 保存用户、密钥、模型路由、账本、日志和系统配置，Drizzle 负责 schema 和迁移。
- Redis 用于缓存、限流、队列和多实例事件同步。
- AI 请求进入 `/api/gateway/ai/*` 后，会先校验消费者密钥，再检查模型权限、限流和余额，然后按模型路由选择供应商和上游。
- 上游调用成功后，系统记录用量、成本、账单流水和访问日志。流式响应会先转发给客户端，计费和日志写入异步完成。

模型路由按三层处理：

1. 模型到供应商：决定一个模型由哪个供应商处理。
2. 供应商到上游：决定请求发往哪个上游地址。
3. 上游模型映射：决定发给上游时使用的实际模型名。

更详细的流程在 `docs/architecture/request-lifecycle.md` 和 `docs/architecture/ai-routing.md`。

### 本地配置

要求：

- Node.js 20+
- pnpm
- Docker 和 Docker Compose

安装依赖：

```bash
pnpm install
```

创建环境变量文件：

```bash
cp .env.example .env.local
pnpm generate-secrets
```

把生成的 `JWT_SECRET`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 写入 `.env.local`。

本地 PostgreSQL 和 Redis 由脚本启动：

```bash
pnpm dev:services
```

脚本会打印实际连接串。确认 `.env.local` 里的值与脚本输出一致。当前默认是：

```bash
DATABASE_URL=postgresql://prismix:prismix@localhost:15433/prismix
REDIS_URL=redis://localhost:16378
```

常用可选配置：

- `PORT`：API 端口，默认 `3403`。
- `VITE_DEV_PORT`：前端开发端口，默认 `5189`。
- `ALCHEMY_API_KEY`：启用链上充值扫描时使用。
- `DOMAIN`：生产环境域名，用于 HTTPS 和页面里的网关地址。
- `DEV_SECRET`：仅开发环境使用，开启测试接口 `/api/dev/admin-token`。

### 启动开发环境

```bash
pnpm dev
```

默认入口：

- API: `http://localhost:3403`
- 前端: `http://localhost:5189`
- 健康检查: `http://localhost:3403/api/health`
- AI 网关: `http://localhost:3403/api/gateway/ai/*`
- 文档页: `http://localhost:5189/docs`

停止本地服务：

```bash
pnpm dev:services:stop
```

清空本地数据库和 Redis：

```bash
bash scripts/dev-services.sh reset
```

### 数据库

首次启动空数据库时，服务会自动执行 `drizzle/` 下的迁移并导入 `deploy/seed/pg.sql`。

已有数据库升级时，先执行：

```bash
pnpm db:migrate
```

常用命令：

```bash
pnpm db:generate
pnpm db:studio
pnpm db:reset
```

### 测试和构建

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm preview
```

### 生产部署

生产 Docker 配置在 `deploy/production/`。

基本流程：

```bash
cp .env.example .env.local
pnpm generate-secrets
```

填写 `.env.local`，至少配置：

- `JWT_SECRET`
- `ENCRYPTION_SALT`
- `DATABASE_URL` 或生产 Docker Compose 自动注入的数据库地址
- `REDIS_URL` 或生产 Docker Compose 自动注入的 Redis 地址
- `DOMAIN`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

启动：

```bash
docker compose -f deploy/production/docker-compose.yml up -d --build
```

生产环境会通过 Caddy 提供 HTTPS。上线前请修改默认数据库和 Redis 密码。

---

## English

### What It Is

Prismix is an AI gateway and billing console. It forwards user requests to AI providers and manages model routing, upstream keys, consumer keys, balances, usage logs, notifications, and webhooks.

Use it when you need to:

- Expose one gateway for OpenAI, Anthropic, Gemini, Azure, Bedrock, or OpenAI-compatible upstreams.
- Issue consumer keys starting with `ska_` and control allowed models, rate limits, and spend limits.
- Track usage and cost per request, then charge a Pay Agent balance.
- Manage models, providers, upstreams, keys, users, top-ups, withdrawals, notifications, and system settings from a web console.

### How It Works

Prismix has four main parts: frontend, API server, PostgreSQL, and Redis.

- The frontend uses React, Vite, React Router, TanStack Query, and Tailwind CSS. It contains the admin console, user portal, and public docs.
- The API uses Hono on Node.js. In production it serves both the API and the built frontend.
- PostgreSQL stores users, keys, model routes, ledger entries, logs, and settings. Drizzle handles schema and migrations.
- Redis is used for cache, rate limiting, queues, and cross-instance events.
- AI requests enter through `/api/gateway/ai/*`. The server checks the consumer key, model permissions, rate limits, and balance, then selects a provider and upstream.
- After a successful upstream call, Prismix records usage, cost, ledger entries, and access logs. Streaming responses are forwarded first; billing and logs are written asynchronously.

Model routing has three steps:

1. Model to provider: decides which provider serves a model.
2. Provider to upstream: decides which upstream endpoint receives the request.
3. Upstream model mapping: decides the actual model name sent to that upstream.

More detail is available in `docs/architecture/request-lifecycle.md` and `docs/architecture/ai-routing.md`.

### Local Setup

Requirements:

- Node.js 20+
- pnpm
- Docker and Docker Compose

Install dependencies:

```bash
pnpm install
```

Create the environment file:

```bash
cp .env.example .env.local
pnpm generate-secrets
```

Copy the generated `JWT_SECRET`, `ENCRYPTION_KEY`, and `ENCRYPTION_SALT` into `.env.local`.

Start local PostgreSQL and Redis:

```bash
pnpm dev:services
```

The script prints the real connection strings. Make sure `.env.local` matches them. Current defaults are:

```bash
DATABASE_URL=postgresql://prismix:prismix@localhost:15433/prismix
REDIS_URL=redis://localhost:16378
```

Common optional settings:

- `PORT`: API port. Default: `3403`.
- `VITE_DEV_PORT`: frontend dev port. Default: `5189`.
- `ALCHEMY_API_KEY`: used for on-chain top-up scanning.
- `DOMAIN`: production domain, used for HTTPS and gateway URLs shown in the UI.
- `DEV_SECRET`: development only. Enables `/api/dev/admin-token`.

### Run Locally

```bash
pnpm dev
```

Default URLs:

- API: `http://localhost:3403`
- Frontend: `http://localhost:5189`
- Health check: `http://localhost:3403/api/health`
- AI gateway: `http://localhost:3403/api/gateway/ai/*`
- Docs: `http://localhost:5189/docs`

Stop local services:

```bash
pnpm dev:services:stop
```

Wipe local PostgreSQL and Redis data:

```bash
bash scripts/dev-services.sh reset
```

### Database

On first startup with an empty database, the server applies migrations from `drizzle/` and loads `deploy/seed/pg.sql`.

For an existing database, run this before restarting after schema changes:

```bash
pnpm db:migrate
```

Useful commands:

```bash
pnpm db:generate
pnpm db:studio
pnpm db:reset
```

### Test and Build

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm preview
```

### Production Deploy

Production Docker files are in `deploy/production/`.

Basic flow:

```bash
cp .env.example .env.local
pnpm generate-secrets
```

Fill `.env.local`. At minimum configure:

- `JWT_SECRET`
- `ENCRYPTION_SALT`
- `DATABASE_URL`, unless production Docker Compose injects it
- `REDIS_URL`, unless production Docker Compose injects it
- `DOMAIN`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

Start:

```bash
docker compose -f deploy/production/docker-compose.yml up -d --build
```

Production uses Caddy for HTTPS. Change the default PostgreSQL and Redis passwords before going live.
