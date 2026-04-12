import { useState } from "react";
import { useTranslation } from "react-i18next";

import { KeyRound, Lock } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { SecretInput } from "@/web/components/ui/secret-input";
import { Switch } from "@/web/components/ui/switch";
import { cn } from "@/web/shared/utils";

import type { ProviderState } from "./shared";
import { validateField } from "./shared";

export function OAuthCard({
  provider,
  icon,
  title,
  description,
  config,
  onUpdate,
  loading,
}: {
  provider: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  config: ProviderState;
  onUpdate: (p: Partial<ProviderState>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const idError = validateField(provider, "clientId", config.clientId);
  const secretError = validateField(provider, "clientSecret", config.clientSecret);
  const bgColor = provider === "google" ? "bg-red-500/10" : "bg-gray-500/10";
  const iconColor = provider === "google" ? "text-red-500" : "text-gray-500 dark:text-gray-400";

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = (enabled: boolean) => {
    if (!enabled && (config.clientId || config.clientSecret)) {
      onUpdate({ enabled: false });
      setShowClearConfirm(true);
    } else {
      onUpdate({ enabled });
    }
  };

  return (
    <>
      <Card className={config.enabled ? "ring-1 ring-primary/30" : "opacity-75"}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bgColor}`}
            >
              <span className={iconColor}>{icon}</span>
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">{title}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
            </div>
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={loading} />
          </div>
        </CardHeader>
        {config.enabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.oauth.client-id")}</Label>
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Input
                  value={config.clientId}
                  onChange={(e) => onUpdate({ clientId: e.target.value })}
                  placeholder={`${title} Client ID`}
                  className={`text-xs font-mono ${idError ? "border-destructive" : ""}`}
                  autoComplete="one-time-code"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
              </div>
              {idError && (
                <p className="text-[11px] text-destructive">
                  {t(`admin.login-strategies.validation.${idError}`)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.oauth.client-secret")}</Label>
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <SecretInput
                  value={config.clientSecret}
                  onChange={(e) => onUpdate({ clientSecret: e.target.value })}
                  placeholder={`${title} Client Secret`}
                  className={cn("text-xs flex-1", secretError && "border-destructive")}
                />
              </div>
              {secretError && (
                <p className="text-[11px] text-destructive">
                  {t(`admin.login-strategies.validation.${secretError}`)}
                </p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {provider === "google"
                ? t("admin.login-strategies.google.hint")
                : t("admin.login-strategies.github.hint")}
            </p>
          </CardContent>
        )}
      </Card>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.login-strategies.confirm-clear-title", { provider: title })}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("admin.login-strategies.confirm-clear-desc")}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                onUpdate({ clientId: "", clientSecret: "" });
                setShowClearConfirm(false);
              }}
            >
              {t("admin.login-strategies.confirm-clear-btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
