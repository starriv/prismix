import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Mail } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { cn } from "@/web/shared/utils";

import { ClearConfirmDialog } from "./clear-confirm-dialog";
import {
  EMAIL_BLANK,
  EMAIL_RE,
  emailHasSecrets,
  HOSTNAME_RE,
  RESEND_KEY_RE,
  VALID_SMTP_PORTS,
} from "./types";
import type { EmailConfig } from "./types";

export function EmailCard({
  config,
  onUpdate,
  loading,
}: {
  config: EmailConfig;
  onUpdate: (p: Partial<EmailConfig>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = (enabled: boolean) => {
    if (!enabled && emailHasSecrets(config)) {
      onUpdate({ enabled: false });
      setShowClearConfirm(true);
    } else {
      onUpdate({ enabled });
    }
  };

  return (
    <>
      <Card className={cn(config.enabled ? "ring-1 ring-primary/30" : "opacity-75")}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <Mail className="h-5 w-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">{t("admin.notif.email-title")}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {t("admin.notif.email-desc")}
              </CardDescription>
            </div>
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={loading} />
          </div>
        </CardHeader>
        {config.enabled && (
          <CardContent className="space-y-3 pt-0">
            {/* Provider select */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.notif.form.provider")}</Label>
              <Select
                value={config.provider}
                onValueChange={(v) => onUpdate({ provider: v as "smtp" | "resend" })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smtp">SMTP</SelectItem>
                  <SelectItem value="resend">Resend</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* SMTP fields */}
            {config.provider === "smtp" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("admin.notif.form.smtp-host")}</Label>
                    <Input
                      value={config.smtpHost}
                      onChange={(e) => onUpdate({ smtpHost: e.target.value })}
                      placeholder="smtp.example.com"
                      className={cn(
                        "text-xs font-mono",
                        config.smtpHost &&
                          !HOSTNAME_RE.test(config.smtpHost) &&
                          "border-destructive",
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("admin.notif.form.smtp-port")}</Label>
                    <Select
                      value={config.smtpPort}
                      onValueChange={(v) => onUpdate({ smtpPort: v })}
                    >
                      <SelectTrigger className="w-full text-xs font-mono">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VALID_SMTP_PORTS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                            {p === "465" && " (SSL)"}
                            {p === "587" && " (STARTTLS)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("admin.notif.form.smtp-user")}</Label>
                  <Input
                    value={config.smtpUser}
                    onChange={(e) => onUpdate({ smtpUser: e.target.value })}
                    placeholder="user@example.com"
                    className="text-xs font-mono"
                    autoComplete="one-time-code"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("admin.notif.form.smtp-pass")}</Label>
                  <SecretInput
                    value={config.smtpPass}
                    onChange={(e) => onUpdate({ smtpPass: e.target.value })}
                    placeholder="SMTP password"
                    className="text-xs"
                  />
                </div>
              </>
            )}

            {/* Resend fields */}
            {config.provider === "resend" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("admin.notif.form.resend-key")}</Label>
                <SecretInput
                  value={config.resendKey}
                  onChange={(e) => onUpdate({ resendKey: e.target.value })}
                  placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className={cn(
                    "text-xs",
                    config.resendKey &&
                      config.resendKey !== "****" &&
                      !RESEND_KEY_RE.test(config.resendKey) &&
                      "border-destructive",
                  )}
                />
                {config.resendKey &&
                  config.resendKey !== "****" &&
                  !RESEND_KEY_RE.test(config.resendKey) && (
                    <p className="text-[11px] text-destructive">
                      {t("admin.notif.validation.resend-key-invalid")}
                    </p>
                  )}
              </div>
            )}

            {/* Shared from fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("admin.notif.form.from-address")}</Label>
                <Input
                  value={config.fromAddress}
                  onChange={(e) => onUpdate({ fromAddress: e.target.value })}
                  placeholder="noreply@example.com"
                  className={cn(
                    "text-xs font-mono",
                    config.fromAddress &&
                      !EMAIL_RE.test(config.fromAddress) &&
                      "border-destructive",
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("admin.notif.form.from-name")}</Label>
                <Input
                  value={config.fromName}
                  onChange={(e) => onUpdate({ fromName: e.target.value })}
                  placeholder="My App"
                  className="text-xs"
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <ClearConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        channelName={t("admin.notif.email-title")}
        onClear={() => {
          onUpdate(EMAIL_BLANK);
          setShowClearConfirm(false);
        }}
      />
    </>
  );
}
