import { useTranslation } from "react-i18next";

import { Webhook } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Switch } from "@/web/components/ui/switch";
import { cn } from "@/web/shared/utils";

import type { WebhookConfig } from "./types";

export function WebhookCard({
  config,
  onUpdate,
  loading,
}: {
  config: WebhookConfig;
  onUpdate: (p: Partial<WebhookConfig>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card className={cn(config.enabled ? "ring-1 ring-primary/30" : "opacity-75")}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
            <Webhook className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm">{t("admin.notif.webhook-title")}</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t("admin.notif.webhook-desc")}
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
          <p className="text-[11px] text-muted-foreground">{t("admin.notif.webhook-hint")}</p>
        </CardContent>
      )}
    </Card>
  );
}
