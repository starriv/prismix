import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

export default function DatabasePage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("docs.db.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("docs.db.desc")}</p>
      </div>

      {/* Supported Databases */}
      <DocSection title={t("docs.db.supported.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.db.supported.th.driver")}</TableHead>
                <TableHead>{t("docs.db.supported.th.engine")}</TableHead>
                <TableHead>{t("docs.db.supported.th.use-case")}</TableHead>
                <TableHead>{t("docs.db.supported.th.env")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["pg"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="font-mono text-xs">
                    {t(`docs.db.supported.rows.${k}.driver`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`docs.db.supported.rows.${k}.engine`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`docs.db.supported.rows.${k}.use-case`)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t(`docs.db.supported.rows.${k}.env`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-muted-foreground">{t("docs.db.supported.switch-note")}</p>
      </DocSection>

      {/* How Migrations Work */}
      <DocSection title={t("docs.db.migration.title")}>
        <p className="text-sm text-muted-foreground">{t("docs.db.migration.intro")}</p>
        <CodeBlock>{`drizzle/
├── 0000_xxx.sql           # Generated DDL (drizzle-kit)
└── meta/                  # Journal + snapshots

deploy/seed/
└── pg.sql                 # Default data (networks, tokens)`}</CodeBlock>
      </DocSection>

      {/* Startup Behaviour */}
      <DocSection title={t("docs.db.startup.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.db.startup.th.scenario")}</TableHead>
                <TableHead>{t("docs.db.startup.th.behaviour")}</TableHead>
                <TableHead>{t("docs.db.startup.th.who")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["first-deploy", "restart", "upgrade"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.db.startup.rows.${k}.scenario`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`docs.db.startup.rows.${k}.behaviour`)}
                  </TableCell>
                  <TableCell className="text-sm">{t(`docs.db.startup.rows.${k}.who`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-muted-foreground">{t("docs.db.startup.safety-note")}</p>
      </DocSection>

      {/* Upgrade Procedure */}
      <DocSection title={t("docs.db.upgrade.title")}>
        <h4 className="text-sm font-semibold">{t("docs.db.upgrade.pg.title")}</h4>
        <CodeBlock>{`# 1. Back up
pg_dump -U prismix prismix > backup.sql

# 2. Pull new image
docker compose pull

# 3. Run migrations
docker compose exec prismix pnpm db:migrate

# 4. Restart
docker compose up -d`}</CodeBlock>
      </DocSection>

      {/* Commands */}
      <DocSection title={t("docs.db.commands.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.db.commands.th.cmd")}</TableHead>
                <TableHead>{t("docs.db.commands.th.what")}</TableHead>
                <TableHead>{t("docs.db.commands.th.when")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["generate", "migrate", "reset", "push", "studio"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="font-mono text-xs">
                    {t(`docs.db.commands.rows.${k}.cmd`)}
                  </TableCell>
                  <TableCell className="text-sm">{t(`docs.db.commands.rows.${k}.what`)}</TableCell>
                  <TableCell className="text-sm">{t(`docs.db.commands.rows.${k}.when`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* Developer Workflow */}
      <DocSection title={t("docs.db.workflow.title")}>
        <h4 className="text-sm font-semibold">{t("docs.db.workflow.pre-release.title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.db.workflow.pre-release.desc")}</p>
        <CodeBlock>{`# 1. Edit schema
vim src/server/db/schemas/pg.ts

# 2. Wipe and regenerate
pnpm db:reset

# 3. Restart — fresh DB with latest schema
pnpm dev`}</CodeBlock>

        <h4 className="text-sm font-semibold mt-6">{t("docs.db.workflow.post-release.title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.db.workflow.post-release.desc")}</p>
        <CodeBlock>{`# 1. Edit schema
vim src/server/db/schemas/pg.ts

# 2. Generate incremental migration
pnpm db:generate
# → drizzle/0001_xxx.sql  (new file, additive)

# 3. Test locally
pnpm db:migrate
pnpm test:unit

# 4. Ship — users run db:migrate on their side`}</CodeBlock>
      </DocSection>

      {/* Important Rules */}
      <DocSection title={t("docs.db.rules.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.db.rules.th.rule")}</TableHead>
                <TableHead>{t("docs.db.rules.th.reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["no-delete", "no-modify", "backup-first"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.db.rules.rows.${k}.rule`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.db.rules.rows.${k}.reason`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* Seed Data */}
      <DocSection title={t("docs.db.seed.title")}>
        <p className="text-sm text-muted-foreground">{t("docs.db.seed.desc")}</p>
        <CodeBlock>{`deploy/seed/
└── pg.sql                 # Default networks, tokens, auth config`}</CodeBlock>
        <p className="text-sm text-muted-foreground">{t("docs.db.seed.existing")}</p>
      </DocSection>

      {/* Troubleshooting */}
      <DocSection title={t("docs.db.troubleshooting.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.db.troubleshooting.th.symptom")}</TableHead>
                <TableHead>{t("docs.db.troubleshooting.th.fix")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["migration-fail", "schema-drift", "bad-migration"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.db.troubleshooting.rows.${k}.symptom`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.db.troubleshooting.rows.${k}.fix`)}
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
