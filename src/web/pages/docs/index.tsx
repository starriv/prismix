import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ArrowRight, Blocks, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const GUIDES = [
  {
    icon: Blocks,
    labelKey: "docs.hub.architecture",
    descKey: "docs.hub.architecture-desc",
    href: "/docs/architecture",
  },
  {
    icon: ShieldCheck,
    labelKey: "docs.hub.security",
    descKey: "docs.hub.security-desc",
    href: "/docs/security",
  },
] as const;

export default function DocsIndexPage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("docs.hub.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("docs.hub.desc")}</p>
      </div>

      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}
      >
        {GUIDES.map((s) => (
          <GuideCard
            key={s.href}
            icon={s.icon}
            label={t(s.labelKey)}
            desc={t(s.descKey)}
            href={s.href}
          />
        ))}
      </div>
    </div>
  );
}

// ── Guide card ──────────────────────────────────────

function GuideCard({
  icon: Icon,
  label,
  desc,
  href,
}: {
  icon: LucideIcon;
  label: string;
  desc: string;
  href: string;
}) {
  return (
    <Link
      to={href}
      className="group flex flex-col gap-3 rounded-xl border border-border p-5 transition-all hover:shadow-md hover:border-primary/30"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      <div className="mt-auto flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowRight className="h-3 w-3" />
      </div>
    </Link>
  );
}
