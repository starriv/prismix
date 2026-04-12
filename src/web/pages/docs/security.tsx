import { useTranslation } from "react-i18next";

import { AlertTriangle, CheckCircle2, Code2, FileCheck, Lock, Network, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";

export default function SecurityPage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-8 space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("docs.security.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("docs.security.desc")}</p>
      </div>

      {/* Defense-in-Depth Architecture */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("docs.security.arch.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("docs.security.arch.desc")}</p>
        <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
          {ARCH_LAYERS.map((layer, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                {i + 1}
              </div>
              <span className="text-sm">{t(layer.labelKey)}</span>
              <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                {t(layer.tagKey)}
              </Badge>
            </div>
          ))}
        </div>
      </section>

      {/* Security sections as cards */}
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))" }}
      >
        <SecurityCard
          icon={Wallet}
          title={t("docs.security.authn.title")}
          items={[
            { label: t("docs.security.authn.login"), desc: t("docs.security.authn.login-desc") },
            { label: t("docs.security.authn.nonce"), desc: t("docs.security.authn.nonce-desc") },
            { label: t("docs.security.authn.access"), desc: t("docs.security.authn.access-desc") },
            {
              label: t("docs.security.authn.refresh"),
              desc: t("docs.security.authn.refresh-desc"),
            },
            { label: t("docs.security.authn.scope"), desc: t("docs.security.authn.scope-desc") },
          ]}
        />

        <SecurityCard
          icon={Lock}
          title={t("docs.security.encryption.title")}
          items={[
            { desc: t("docs.security.encryption.aes") },
            { desc: t("docs.security.encryption.pbkdf2") },
            { desc: t("docs.security.encryption.mask") },
            { desc: t("docs.security.encryption.log") },
          ]}
        />

        <SecurityCard
          icon={Code2}
          title={t("docs.security.sandbox.title")}
          subtitle={t("docs.security.sandbox.desc")}
          items={[
            { label: t("docs.security.sandbox.wasm"), desc: t("docs.security.sandbox.wasm-desc") },
            {
              label: t("docs.security.sandbox.memory"),
              desc: t("docs.security.sandbox.memory-desc"),
            },
            { label: t("docs.security.sandbox.cpu"), desc: t("docs.security.sandbox.cpu-desc") },
            {
              label: t("docs.security.sandbox.context"),
              desc: t("docs.security.sandbox.context-desc"),
            },
            { label: t("docs.security.sandbox.size"), desc: t("docs.security.sandbox.size-desc") },
            {
              label: t("docs.security.sandbox.output"),
              desc: t("docs.security.sandbox.output-desc"),
            },
            {
              label: t("docs.security.sandbox.error"),
              desc: t("docs.security.sandbox.error-desc"),
            },
          ]}
        />

        <SecurityCard
          icon={Network}
          title={t("docs.security.network.title")}
          items={[
            { desc: t("docs.security.network.rate-limit") },
            { desc: t("docs.security.network.circuit-breaker") },
            { desc: t("docs.security.network.timeout") },
            { desc: t("docs.security.network.hop-by-hop") },
            { desc: t("docs.security.network.cors") },
            { desc: t("docs.security.network.proxy-headers") },
          ]}
        />

        <SecurityCard
          icon={FileCheck}
          title={t("docs.security.validation.title")}
          items={[
            { desc: t("docs.security.validation.headers") },
            { desc: t("docs.security.validation.cors") },
            { desc: t("docs.security.validation.auth-profile") },
            { desc: t("docs.security.validation.forbidden") },
          ]}
        />

        <SecurityCard
          icon={AlertTriangle}
          title={t("docs.security.errors.title")}
          items={[
            { desc: t("docs.security.errors.prod") },
            { desc: t("docs.security.errors.script") },
            { desc: t("docs.security.errors.upstream") },
          ]}
        />
      </div>
    </div>
  );
}

// ── Architecture layers ─────────────────────────────────────────────

const ARCH_LAYERS = [
  { labelKey: "docs.security.arch.l1", tagKey: "docs.security.arch.t1" },
  { labelKey: "docs.security.arch.l2", tagKey: "docs.security.arch.t2" },
  { labelKey: "docs.security.arch.l3", tagKey: "docs.security.arch.t3" },
  { labelKey: "docs.security.arch.l4", tagKey: "docs.security.arch.t4" },
  { labelKey: "docs.security.arch.l5", tagKey: "docs.security.arch.t5" },
  { labelKey: "docs.security.arch.l6", tagKey: "docs.security.arch.t6" },
  { labelKey: "docs.security.arch.l7", tagKey: "docs.security.arch.t7" },
  { labelKey: "docs.security.arch.l8", tagKey: "docs.security.arch.t8" },
];

// ── Security card ───────────────────────────────────────────────────

interface SecurityItem {
  label?: string;
  desc: string;
}

function SecurityCard({
  icon: Icon,
  title,
  subtitle,
  items,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  items: SecurityItem[];
}) {
  return (
    <div className="rounded-xl border border-border p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span>
              {item.label && <span className="font-medium">{item.label}: </span>}
              <span className="text-muted-foreground">{item.desc}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
