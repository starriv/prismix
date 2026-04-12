import { useTranslation } from "react-i18next";

import { CheckCircle2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

export default function DeployProductionPage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("docs.production.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("docs.production.desc")}</p>
      </div>

      {/* Architecture */}
      <DocSection title={t("docs.production.arch.title")}>
        <CodeBlock>{`Internet → Caddy (:443 HTTPS) → Prismix (:3403)
                                     ↓
                     PostgreSQL 17 ←──┤──→ Redis 7
                     (persistent)     (cache + pub/sub)`}</CodeBlock>
        <ul className="space-y-2 text-sm">
          <BulletItem label="Prismix" desc={t("docs.production.arch.prismix")} />
          <BulletItem label="Caddy" desc={t("docs.production.arch.caddy")} />
          <BulletItem label="PostgreSQL 17" desc={t("docs.production.arch.postgres")} />
          <BulletItem label="Redis 7" desc={t("docs.production.arch.redis")} />
        </ul>
      </DocSection>

      {/* Requirements */}
      <DocSection title={t("docs.production.requirements.title")}>
        <ul className="space-y-2 text-sm">
          {(["linux", "docker", "domain", "ports", "ram"] as const).map((k) => (
            <li key={k} className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>{t(`docs.production.requirements.${k}`)}</span>
            </li>
          ))}
        </ul>
      </DocSection>

      {/* Quick Start */}
      <DocSection title={t("docs.production.quick-start.title")}>
        <h4 className="text-sm font-semibold">{t("docs.production.quick-start.step1.title")}</h4>
        <CodeBlock>{`git clone ${__GIT_REPO_URL__ || "https://github.com/<your-org>/prismix"}.git
cd prismix

# Copy and edit environment variables
cp .env.example .env.local
nano .env.local`}</CodeBlock>
        <p className="text-sm text-muted-foreground">
          {t("docs.production.quick-start.step1.set-minimum")}
        </p>
        <ul className="text-sm space-y-1 ml-4">
          <li>
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">DOMAIN</code> —{" "}
            {t("docs.production.quick-start.step1.domain")}
          </li>
          <li>
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">JWT_SECRET</code> —{" "}
            {t("docs.production.quick-start.step1.jwt")}
          </li>
          <li>
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              POSTGRES_PASSWORD
            </code>{" "}
            — {t("docs.production.quick-start.step1.pg-password")}
          </li>
        </ul>

        <h4 className="text-sm font-semibold mt-6">
          {t("docs.production.quick-start.step2.title")}
        </h4>
        <CodeBlock>docker compose -f deploy/production/docker-compose.yml up -d</CodeBlock>

        <h4 className="text-sm font-semibold mt-6">
          {t("docs.production.quick-start.step3.title")}
        </h4>
        <CodeBlock>{`curl https://your-domain.com/api/health

# {"status":"ok","checks":{"db":"ok","uptime":...}}`}</CodeBlock>
      </DocSection>

      {/* Operations */}
      <DocSection title={t("docs.production.ops.title")}>
        <OpBlock
          label={t("docs.production.ops.logs")}
          cmd="docker compose -f deploy/production/docker-compose.yml logs -f prismix"
        />
        <OpBlock
          label={t("docs.production.ops.restart")}
          cmd="docker compose -f deploy/production/docker-compose.yml restart prismix"
        />
        <OpBlock
          label={t("docs.production.ops.update")}
          cmd={`git pull\ndocker compose -f deploy/production/docker-compose.yml up -d --build`}
        />
        <OpBlock
          label={t("docs.production.ops.backup")}
          cmd="docker exec prismix-postgres pg_dump -U prismix prismix > backup-$(date +%Y%m%d).sql"
        />
        <OpBlock
          label={t("docs.production.ops.restore")}
          cmd={`docker compose -f deploy/production/docker-compose.yml down
docker compose -f deploy/production/docker-compose.yml up -d postgres
sleep 5
docker exec -i prismix-postgres psql -U prismix prismix < backup.sql
docker compose -f deploy/production/docker-compose.yml up -d`}
        />
        <OpBlock
          label={t("docs.production.ops.redis-flush")}
          cmd="docker exec prismix-redis redis-cli FLUSHALL"
        />
      </DocSection>

      {/* Configuration */}
      <DocSection title={t("docs.production.config.title")}>
        <h4 className="text-sm font-semibold">{t("docs.production.config.external-db.title")}</h4>
        <p className="text-sm text-muted-foreground">
          {t("docs.production.config.external-db.desc")}
        </p>

        <h4 className="text-sm font-semibold mt-6">
          {t("docs.production.config.behind-proxy.title")}
        </h4>
        <p className="text-sm text-muted-foreground">
          {t("docs.production.config.behind-proxy.desc")}
        </p>
      </DocSection>

      {/* Troubleshooting */}
      <DocSection title={t("docs.production.troubleshooting.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.production.troubleshooting.th.symptom")}</TableHead>
                <TableHead>{t("docs.production.troubleshooting.th.cause")}</TableHead>
                <TableHead>{t("docs.production.troubleshooting.th.fix")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                [
                  "eacces",
                  "https",
                  "pg-refused",
                  "redis-refused",
                  "health",
                  "pg-auth",
                  "memory",
                ] as const
              ).map((k) => (
                <TableRow key={k}>
                  <TableCell className="font-mono text-xs">
                    {t(`docs.production.troubleshooting.rows.${k}.symptom`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`docs.production.troubleshooting.rows.${k}.cause`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`docs.production.troubleshooting.rows.${k}.fix`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="font-mono text-xs bg-muted rounded-lg p-4 overflow-x-auto whitespace-pre">
      <code>{children}</code>
    </pre>
  );
}

function BulletItem({ label, desc }: { label: string; desc: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="font-semibold shrink-0">{label}:</span>
      <span className="text-muted-foreground">{desc}</span>
    </li>
  );
}

function OpBlock({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{label}</h4>
      <CodeBlock>{cmd}</CodeBlock>
    </div>
  );
}
