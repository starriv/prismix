import { useTranslation } from "react-i18next";

export default function ArchitecturePage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("docs.arch.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("docs.arch.desc")}</p>
      </div>

      {/* Gateway Pipeline */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("docs.arch.flow.title")}</h2>
        <CodeBlock>{`Client ──── POST /api/ai/chat ────────────────────────> AI Gateway
            │
            ├─ 1. Auth middleware (JWT / API key)
            ├─ 2. Rate limiter (sliding window, per-key/global)
            ├─ 3. Model routing + provider selection
            ├─ 4. Request logging (optional, configurable)
            ├─ 5. Upstream AI provider fetch (timeout + retry)
            └─ 6. SSE streaming / JSON response
       <─── HTTP 200 + AI response ──────────────────────`}</CodeBlock>
        <p className="text-sm text-muted-foreground">{t("docs.arch.flow.desc")}</p>
      </section>

      {/* Authentication */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("docs.arch.auth.title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("docs.arch.auth.desc")}</p>
        <CodeBlock>{`Auth strategies:
  SIWE        — Wallet sign-in via MetaMask/WalletConnect (EIP-4361)
  Credentials — Email + password (bcrypt, local accounts)
  Google      — OAuth 2.0 redirect flow
  GitHub      — OAuth 2.0 redirect flow

Flow (all strategies):
  1. Client requests nonce / redirects to OAuth provider
  2. Server verifies signature / exchanges code for profile
  3. Identity resolved → JWT + refresh token issued
  4. JWT refresh: POST /api/auth/refresh { refreshToken }
     (single-use rotation, old token deleted)`}</CodeBlock>
      </section>

      {/* Multi-tenancy */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("docs.arch.tenant.title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.arch.tenant.desc")}
        </p>
        <CodeBlock>{`merchants (id, address, uuid)
  ├── api_keys             (merchant_id FK, hashed key, scoped access)
  ├── merchant_settings    (merchant_id + key, unique)
  ├── notification_configs (merchant_id, provider, channel config)
  └── notification_logs    (merchant_id, delivery records)

identities               ← maps auth providers to users (SIWE, credentials, OAuth)
admins (id, address)     ← separate auth, first wallet = auto-admin
global_settings          ← AI provider config (Admin UI), gateway config
refresh_tokens           ← JWT refresh (hashed, single-use rotation)`}</CodeBlock>
      </section>

      {/* Infrastructure */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("docs.arch.hotpath.title")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">{t("docs.arch.hotpath.th-component")}</th>
                <th className="pb-2 pr-4 font-medium">{t("docs.arch.hotpath.th-mechanism")}</th>
                <th className="pb-2 font-medium">{t("docs.arch.hotpath.th-latency")}</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground text-xs">
              <tr className="border-b">
                <td className="py-2 pr-4">{t("docs.arch.hotpath.cache")}</td>
                <td className="py-2 pr-4">{t("docs.arch.hotpath.cache-mech")}</td>
                <td className="py-2 font-mono">&lt;0.1ms</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">{t("docs.arch.hotpath.limiter")}</td>
                <td className="py-2 pr-4">{t("docs.arch.hotpath.limiter-mech")}</td>
                <td className="py-2 font-mono">&lt;0.1ms</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">{t("docs.arch.hotpath.writes")}</td>
                <td className="py-2 pr-4">{t("docs.arch.hotpath.writes-mech")}</td>
                <td className="py-2 font-mono">0ms (async)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Project Structure */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("docs.arch.structure.title")}</h2>
        <CodeBlock>{`src/
├── server/
│   ├── index.ts              # Hono app, middleware, graceful shutdown
│   ├── ai/                   # AI Gateway core
│   │   ├── routes/           #   AI chat, completions, model routing
│   │   └── lib/              #   provider adapters, streaming, config
│   ├── merchant/routes/      # Merchant CRUD (API keys, settings, webhooks, etc.)
│   ├── admin/routes/         # Admin panel (merchants, settings)
│   ├── auth/                 # Authentication
│   │   ├── routes/           #   Merchant login/register/OAuth/refresh
│   │   ├── strategies/       #   siwe, credentials, google, github, oidc, saml
│   │   └── strategy.ts       #   AuthStrategy interface + registry
│   ├── messaging/            # Notifications + Webhooks
│   │   ├── notifications/    #   dispatcher, channels (email, telegram, webhook)
│   │   └── webhooks/         #   HMAC delivery + retry jobs
│   ├── db/                   # Database (PostgreSQL via Drizzle ORM)
│   ├── cache/                # CacheStore (Memory dev / Redis prod)
│   ├── queue/                # JobQueue (Memory dev / BullMQ+Redis prod)
│   ├── rate-limit/           # RateLimitStore (Memory dev / Redis prod)
│   ├── events/               # EventBus (Memory dev / Redis pub-sub prod)
│   ├── repos/                # Async repositories — all DB access
│   ├── middleware/            # Shared middleware (auth, request-id, http-logger)
│   ├── lib/                  # Shared infra (jwt, crypto, sse, logger, redis, metrics)
│   └── routes/               # Route registration + health
├── shared/                   # Pure utils (number, http-headers, url)
├── i18n/locales/             # en.json + zh.json
├── __tests__/
│   ├── unit/                 # Server, shared unit tests
│   ├── integration/          # Full pipeline tests
│   └── e2e/                  # Playwright browser tests
└── web/
    ├── api/                  # Typed client, Zod schemas, TanStack Query hooks
    ├── components/           # ui/, dashboard/, admin/, auth/, docs/, home/
    ├── pages/                # One file per route (+ admin/, docs/ subdirs)
    ├── providers/            # AuthProvider, AdminAuthProvider
    ├── layouts/              # DashboardLayout, AdminLayout, DocsLayout
    ├── hooks/                # Custom React hooks
    └── app.tsx               # React Router v7 route tree`}</CodeBlock>
      </section>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="font-mono text-xs bg-muted rounded-lg p-4 overflow-x-auto whitespace-pre">
      <code>{children}</code>
    </pre>
  );
}
