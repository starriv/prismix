import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Building2, KeyRound, Lock } from "lucide-react";

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

import type { ProviderState } from "./shared";

export function OidcCard({
  config,
  onUpdate,
  loading,
}: {
  config: ProviderState;
  onUpdate: (p: Partial<ProviderState>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const issuerError = config.issuer?.trim() && !config.issuer.startsWith("https://");

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = (enabled: boolean) => {
    if (!enabled && (config.clientId || config.clientSecret || config.issuer)) {
      onUpdate({ enabled: false });
      setShowClearConfirm(true);
    } else {
      onUpdate({ enabled });
    }
  };

  const handleScopesChange = (value: string) => {
    const scopes = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onUpdate({ scopes: scopes.length > 0 ? scopes : undefined });
  };

  return (
    <>
      <Card className={config.enabled ? "ring-1 ring-primary/30" : "opacity-75"}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
              <Building2 className="h-5 w-5 text-violet-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">{t("admin.login-strategies.oidc.title")}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {t("admin.login-strategies.oidc.desc")}
              </CardDescription>
            </div>
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={loading} />
          </div>
        </CardHeader>
        {config.enabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("admin.login-strategies.oidc.display-name-label")}
              </Label>
              <Input
                value={config.displayName ?? ""}
                onChange={(e) => onUpdate({ displayName: e.target.value })}
                placeholder={t("admin.login-strategies.oidc.display-name-ph")}
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.oidc.issuer-label")}</Label>
              <Input
                value={config.issuer ?? ""}
                onChange={(e) => onUpdate({ issuer: e.target.value })}
                placeholder={t("admin.login-strategies.oidc.issuer-ph")}
                className={`text-xs font-mono ${issuerError ? "border-destructive" : ""}`}
              />
              {issuerError && (
                <p className="text-[11px] text-destructive">
                  {t("admin.login-strategies.validation.oidc-issuer")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.oauth.client-id")}</Label>
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Input
                  value={config.clientId}
                  onChange={(e) => onUpdate({ clientId: e.target.value })}
                  placeholder="Client ID"
                  className="text-xs font-mono"
                  autoComplete="one-time-code"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.oauth.client-secret")}</Label>
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <SecretInput
                  value={config.clientSecret}
                  onChange={(e) => onUpdate({ clientSecret: e.target.value })}
                  placeholder="Client Secret"
                  className="text-xs flex-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.oidc.scopes-label")}</Label>
              <Input
                value={config.scopes?.join(", ") ?? ""}
                onChange={(e) => handleScopesChange(e.target.value)}
                placeholder={t("admin.login-strategies.oidc.scopes-ph")}
                className="text-xs"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("admin.login-strategies.oidc.hint")}
            </p>
          </CardContent>
        )}
      </Card>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.login-strategies.confirm-clear-title", { provider: "OIDC" })}
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
                onUpdate({
                  clientId: "",
                  clientSecret: "",
                  issuer: "",
                  displayName: "",
                  scopes: undefined,
                });
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
