import { useTranslation } from "react-i18next";

export function useChannelLabels() {
  const { t } = useTranslation();
  return {
    email: t("notif.channel.email"),
    telegram: t("notif.channel.telegram"),
    webhook: t("notif.channel.webhook"),
    whatsapp: t("notif.channel.whatsapp"),
  } as Record<string, string>;
}
