import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Copy, Loader2, Search, Shield } from "lucide-react";
import { toast } from "sonner";

import { useDiscoverSamlMetadata } from "@/web/api/admin-hooks";
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
import { Switch } from "@/web/components/ui/switch";
import { Textarea } from "@/web/components/ui/textarea";

import type { ProviderState } from "./shared";

export function SamlCard({
  config,
  onUpdate,
  loading,
}: {
  config: ProviderState;
  onUpdate: (p: Partial<ProviderState>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const discoverMut = useDiscoverSamlMetadata();
  const metadataUrl = config.metadataUrl ?? "";
  const ssoUrlError = config.ssoUrl?.trim() && !config.ssoUrl.startsWith("https://");

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = useCallback(
    (enabled: boolean) => {
      if (!enabled && (config.entityId || config.ssoUrl || config.certificate)) {
        onUpdate({ enabled: false });
        setShowClearConfirm(true);
      } else {
        onUpdate({ enabled });
      }
    },
    [config.entityId, config.ssoUrl, config.certificate, onUpdate],
  );

  const handleDiscover = async () => {
    if (!metadataUrl.startsWith("https://")) return;
    try {
      const result = await discoverMut.mutateAsync(metadataUrl);
      onUpdate({
        entityId: result.entityId,
        ssoUrl: result.ssoUrl,
        certificate: result.certificate,
        metadataUrl,
      });
      toast.success(t("admin.login-strategies.saml.discover-success"));
    } catch {
      toast.error(t("admin.login-strategies.saml.discover-error"));
    }
  };

  const spMetadataUrl = `${window.location.origin}/api/auth/saml/metadata`;

  const handleCopySpMetadata = () => {
    navigator.clipboard.writeText(spMetadataUrl);
    toast.success("Copied!");
  };

  return (
    <>
      <Card className={config.enabled ? "ring-1 ring-primary/30" : "opacity-75"}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
              <Shield className="h-5 w-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">{t("admin.login-strategies.saml.title")}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {t("admin.login-strategies.saml.desc")}
              </CardDescription>
            </div>
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={loading} />
          </div>
        </CardHeader>
        {config.enabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("admin.login-strategies.saml.display-name-label")}
              </Label>
              <Input
                value={config.displayName ?? ""}
                onChange={(e) => onUpdate({ displayName: e.target.value })}
                placeholder={t("admin.login-strategies.saml.display-name-ph")}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("admin.login-strategies.saml.metadata-url-label")}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={metadataUrl}
                  onChange={(e) => onUpdate({ metadataUrl: e.target.value })}
                  placeholder={t("admin.login-strategies.saml.metadata-url-ph")}
                  className="text-xs font-mono flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  disabled={!metadataUrl.startsWith("https://") || discoverMut.isPending}
                  onClick={handleDiscover}
                >
                  {discoverMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  {t("admin.login-strategies.saml.discover-btn")}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.saml.entity-id-label")}</Label>
              <Input
                value={config.entityId ?? ""}
                onChange={(e) => onUpdate({ entityId: e.target.value })}
                placeholder={t("admin.login-strategies.saml.entity-id-ph")}
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.login-strategies.saml.sso-url-label")}</Label>
              <Input
                value={config.ssoUrl ?? ""}
                onChange={(e) => onUpdate({ ssoUrl: e.target.value })}
                placeholder={t("admin.login-strategies.saml.sso-url-ph")}
                className={`text-xs font-mono ${ssoUrlError ? "border-destructive" : ""}`}
              />
              {ssoUrlError && (
                <p className="text-[11px] text-destructive">
                  {t("admin.login-strategies.validation.saml-sso-url")}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("admin.login-strategies.saml.certificate-label")}
              </Label>
              <Textarea
                value={config.certificate ?? ""}
                onChange={(e) => onUpdate({ certificate: e.target.value })}
                placeholder={t("admin.login-strategies.saml.certificate-ph")}
                className="text-xs font-mono h-20 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("admin.login-strategies.saml.sp-metadata-label")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={spMetadataUrl}
                  readOnly
                  className="text-xs font-mono text-muted-foreground bg-muted"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleCopySpMetadata}
                  aria-label={t("common.a11y.copy")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("admin.login-strategies.saml.sp-metadata-hint")}
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {t("admin.login-strategies.saml.hint")}
            </p>
          </CardContent>
        )}
      </Card>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.login-strategies.confirm-clear-title", { provider: "SAML" })}
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
                  entityId: "",
                  ssoUrl: "",
                  certificate: "",
                  displayName: "",
                  metadataUrl: "",
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
