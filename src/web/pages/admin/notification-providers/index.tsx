import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  useAdminNotificationProviders,
  useUpdateAdminNotificationProviders,
} from "@/web/api/admin-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";

import { EmailCard } from "./email-card";
import { TelegramCard } from "./telegram-card";
import { validateConfig } from "./types";
import type { ConfigState } from "./types";
import { INITIAL_STATE } from "./types";
import { WebhookCard } from "./webhook-card";
import { WhatsAppCard } from "./whatsapp-card";

export default function AdminNotificationProvidersPage() {
  const { t } = useTranslation();
  const { data: serverConfig, isLoading } = useAdminNotificationProviders();
  const updateConfig = useUpdateAdminNotificationProviders();

  const [config, setConfig] = useState<ConfigState>(INITIAL_STATE);
  const [dirty, setDirty] = useState(false);

  // Sync from server
  useEffect(() => {
    if (!serverConfig) return;
    const e = serverConfig.email as Record<string, unknown> | undefined;
    const tg = serverConfig.telegram as Record<string, unknown> | undefined;
    const wh = serverConfig.webhook as Record<string, unknown> | undefined;
    const wa = serverConfig.whatsapp as Record<string, unknown> | undefined;

    const next: ConfigState = {
      email: {
        enabled: (e?.enabled as boolean) ?? false,
        provider: ((e?.provider as string) === "resend" ? "resend" : "smtp") as "smtp" | "resend",
        smtpHost: (e?.smtpHost as string) ?? "",
        smtpPort: String((e?.smtpPort as number) ?? 587),
        smtpUser: (e?.smtpUser as string) ?? "",
        smtpPass: (e?.smtpPass as string) ?? "",
        resendKey: (e?.resendApiKey as string) ?? "",
        fromAddress: (e?.fromAddress as string) ?? "",
        fromName: (e?.fromName as string) ?? "",
      },
      telegram: {
        enabled: (tg?.enabled as boolean) ?? false,
        botToken: (tg?.botToken as string) ?? "",
      },
      webhook: { enabled: (wh?.enabled as boolean) ?? false },
      whatsapp: {
        enabled: (wa?.enabled as boolean) ?? false,
        apiToken: (wa?.apiToken as string) ?? "",
        phoneNumberId: (wa?.phoneNumberId as string) ?? "",
      },
    };
    setConfig(next);
    setDirty(false);
  }, [serverConfig]);

  function updateChannel<K extends keyof ConfigState>(channel: K, patch: Partial<ConfigState[K]>) {
    setConfig((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], ...patch },
    }));
    setDirty(true);
  }

  const validationError = validateConfig(config);

  const handleSave = async () => {
    if (validationError) {
      toast.error(t(`admin.notif.validation.${validationError}`));
      return;
    }
    try {
      // Map local field names to server field names
      const payload = {
        email: {
          enabled: config.email.enabled,
          provider: config.email.provider,
          smtpHost: config.email.smtpHost,
          smtpPort: Number(config.email.smtpPort) || 587,
          smtpUser: config.email.smtpUser,
          smtpPass: config.email.smtpPass,
          resendApiKey: config.email.resendKey,
          fromAddress: config.email.fromAddress,
          fromName: config.email.fromName,
        },
        telegram: config.telegram,
        webhook: config.webhook,
        whatsapp: config.whatsapp,
      };
      await updateConfig.mutateAsync(payload as unknown as Record<string, Record<string, unknown>>);
      toast.success(t("admin.notif.toast.saved"));
      setDirty(false);
    } catch {
      toast.error(t("admin.notif.toast.save-error"));
    }
  };

  return (
    <div>
      <Header title={t("admin.notif.title")} description={t("admin.notif.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <EmailCard
            config={config.email}
            onUpdate={(p) => updateChannel("email", p)}
            loading={isLoading}
          />
          <TelegramCard
            config={config.telegram}
            onUpdate={(p) => updateChannel("telegram", p)}
            loading={isLoading}
          />
          <WebhookCard
            config={config.webhook}
            onUpdate={(p) => updateChannel("webhook", p)}
            loading={isLoading}
          />
          <WhatsAppCard
            config={config.whatsapp}
            onUpdate={(p) => updateChannel("whatsapp", p)}
            loading={isLoading}
          />
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={!dirty || updateConfig.isPending}
            className="gap-2"
          >
            {updateConfig.isPending ? (
              <span className="animate-spin">
                <Loader2 className="h-4 w-4" />
              </span>
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("admin.notif.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
