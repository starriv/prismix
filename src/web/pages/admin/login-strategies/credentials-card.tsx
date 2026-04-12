import { useTranslation } from "react-i18next";

import { Mail } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Switch } from "@/web/components/ui/switch";

import type { ProviderState } from "./shared";

export function CredentialsCard({
  config,
  onUpdate,
  loading,
}: {
  config: ProviderState;
  onUpdate: (p: Partial<ProviderState>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className={config.enabled ? "ring-1 ring-primary/30" : "opacity-75"}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <Mail className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm">
              {t("admin.login-strategies.credentials.title")}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t("admin.login-strategies.credentials.desc")}
            </CardDescription>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => onUpdate({ enabled: v })}
            disabled={loading}
          />
        </div>
      </CardHeader>
      {config.enabled && (
        <CardContent className="pt-0">
          <p className="text-[11px] text-muted-foreground">
            {t("admin.login-strategies.credentials.hint")}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
