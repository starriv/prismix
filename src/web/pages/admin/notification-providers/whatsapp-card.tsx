import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Phone } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { SecretInput } from "@/web/components/ui/secret-input";
import { Switch } from "@/web/components/ui/switch";
import { cn } from "@/web/shared/utils";

import { ClearConfirmDialog } from "./clear-confirm-dialog";
import {
  WHATSAPP_BLANK,
  WHATSAPP_PHONE_ID_RE,
  WHATSAPP_TOKEN_RE,
  whatsappHasSecrets,
} from "./types";
import type { WhatsAppConfig } from "./types";

export function WhatsAppCard({
  config,
  onUpdate,
  loading,
}: {
  config: WhatsAppConfig;
  onUpdate: (p: Partial<WhatsAppConfig>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = (enabled: boolean) => {
    if (!enabled && whatsappHasSecrets(config)) {
      onUpdate({ enabled: false });
      setShowClearConfirm(true);
    } else {
      onUpdate({ enabled });
    }
  };

  const tokenInvalid =
    config.apiToken && config.apiToken !== "****" && !WHATSAPP_TOKEN_RE.test(config.apiToken);
  const phoneIdInvalid = config.phoneNumberId && !WHATSAPP_PHONE_ID_RE.test(config.phoneNumberId);

  return (
    <>
      <Card className={cn(config.enabled ? "ring-1 ring-primary/30" : "opacity-75")}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
              <Phone className="h-5 w-5 text-green-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">{t("admin.notif.whatsapp-title")}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {t("admin.notif.whatsapp-desc")}
              </CardDescription>
            </div>
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={loading} />
          </div>
        </CardHeader>
        {config.enabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.notif.form.api-token")}</Label>
              <SecretInput
                value={config.apiToken}
                onChange={(e) => onUpdate({ apiToken: e.target.value })}
                placeholder="EAAxxxxxxx..."
                className={cn("text-xs", tokenInvalid && "border-destructive")}
              />
              {tokenInvalid && (
                <p className="text-[11px] text-destructive">
                  {t("admin.notif.validation.whatsapp-token-invalid")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.notif.form.phone-id")}</Label>
              <Input
                value={config.phoneNumberId}
                onChange={(e) => onUpdate({ phoneNumberId: e.target.value })}
                placeholder="106540352242922"
                className={cn("text-xs font-mono", phoneIdInvalid && "border-destructive")}
              />
              {phoneIdInvalid && (
                <p className="text-[11px] text-destructive">
                  {t("admin.notif.validation.whatsapp-phone-id-invalid")}
                </p>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <ClearConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        channelName={t("admin.notif.whatsapp-title")}
        onClear={() => {
          onUpdate(WHATSAPP_BLANK);
          setShowClearConfirm(false);
        }}
      />
    </>
  );
}
