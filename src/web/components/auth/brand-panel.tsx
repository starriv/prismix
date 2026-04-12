import { useTranslation } from "react-i18next";

import { BarChart3, Network, Scale } from "lucide-react";

import { Logo } from "@/web/components/ui/logo";

const FEATURES = [
  { icon: Network, key: "fast" },
  { icon: Scale, key: "secure" },
  { icon: BarChart3, key: "track" },
];

export function BrandPanel() {
  const { t } = useTranslation();

  return (
    <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-foreground text-background p-12">
      {/* Top */}
      <div>
        <Logo variant="dark" className="h-6 w-6" />
      </div>

      {/* Center */}
      <div className="space-y-10">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-background/20 bg-background/10 px-3 py-1 text-xs font-mono text-background/70">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("auth.brand.badge")}
          </div>
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            {t("auth.brand.title-1")}
            <br />
            <span className="text-background/60">{t("auth.brand.title-2")}</span>
          </h1>
          <p className="text-sm text-background/50 leading-relaxed max-w-sm">
            {t("auth.brand.desc")}
          </p>
        </div>

        <ul className="space-y-4">
          {FEATURES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background/10 mt-0.5">
                <Icon className="h-3.5 w-3.5 text-background/70" />
              </div>
              <div>
                <p className="text-sm font-medium text-background/90">
                  {t(`auth.brand.feat.${key}.title`)}
                </p>
                <p className="text-xs text-background/50 mt-0.5">
                  {t(`auth.brand.feat.${key}.desc`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom */}
      <p className="text-xs text-background/30 font-mono">{t("auth.brand.protocol")}</p>
    </div>
  );
}
