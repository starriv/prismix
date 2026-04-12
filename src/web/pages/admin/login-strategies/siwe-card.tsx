import { useTranslation } from "react-i18next";

import { Wallet } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";
import { Switch } from "@/web/components/ui/switch";

export function SiweCard() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Wallet className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{t("admin.login-strategies.siwe.title")}</h3>
            <Badge variant="secondary" className="text-[10px]">
              {t("admin.login-strategies.always-on")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.login-strategies.siwe.desc")}
          </p>
        </div>
        <Switch checked disabled />
      </div>
    </div>
  );
}
