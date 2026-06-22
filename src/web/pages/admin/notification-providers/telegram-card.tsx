import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MessageCircle } from "lucide-react";

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
  TELEGRAM_BLANK,
  TELEGRAM_CHAT_ID_RE,
  TELEGRAM_TOKEN_RE,
  telegramHasSecrets,
} from "./types";
import type { TelegramConfig } from "./types";

export function TelegramCard({
  config,
  onUpdate,
  loading,
}: {
  config: TelegramConfig;
  onUpdate: (p: Partial<TelegramConfig>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = (enabled: boolean) => {
    if (!enabled && telegramHasSecrets(config)) {
      onUpdate({ enabled: false });
      setShowClearConfirm(true);
    } else {
      onUpdate({ enabled });
    }
  };

  const tokenInvalid =
    config.botToken && config.botToken !== "****" && !TELEGRAM_TOKEN_RE.test(config.botToken);
  const chatIdInvalid = config.chatId && !TELEGRAM_CHAT_ID_RE.test(config.chatId);

  return (
    <>
      <Card className={cn(config.enabled ? "ring-1 ring-primary/30" : "opacity-75")}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
              <MessageCircle className="h-5 w-5 text-sky-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">{t("admin.notif.telegram-title")}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {t("admin.notif.telegram-desc")}
              </CardDescription>
            </div>
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={loading} />
          </div>
        </CardHeader>
        {config.enabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.notif.form.bot-token")}</Label>
              <SecretInput
                value={config.botToken}
                onChange={(e) => onUpdate({ botToken: e.target.value })}
                placeholder="123456789:ABCdef-GHIjklMNOpqrSTUvwxYZ012345a"
                className={cn("text-xs", tokenInvalid && "border-destructive")}
              />
              {tokenInvalid && (
                <p className="text-[11px] text-destructive">
                  {t("admin.notif.validation.telegram-token-invalid")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("admin.notif.form.chat-id")}</Label>
              <Input
                value={config.chatId}
                onChange={(e) => onUpdate({ chatId: e.target.value })}
                placeholder="-1001234567890"
                className={cn("text-xs", chatIdInvalid && "border-destructive")}
              />
              {chatIdInvalid && (
                <p className="text-[11px] text-destructive">
                  {t("admin.notif.validation.telegram-chat-id-invalid")}
                </p>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <ClearConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        channelName={t("admin.notif.telegram-title")}
        onClear={() => {
          onUpdate(TELEGRAM_BLANK);
          setShowClearConfirm(false);
        }}
      />
    </>
  );
}
