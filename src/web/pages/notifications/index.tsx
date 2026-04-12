import { useTranslation } from "react-i18next";

import { Header } from "@/web/components/dashboard/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";

import { ChannelsTab } from "./channels-tab";
import { LogsTab } from "./logs-tab";

export default function NotificationsPage() {
  const { t } = useTranslation();

  return (
    <div>
      <Header title={t("notif.title")} description={t("notif.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <Tabs defaultValue="configs">
          <TabsList className="w-full">
            <TabsTrigger value="configs">{t("notif.tab.configs")}</TabsTrigger>
            <TabsTrigger value="logs">{t("notif.tab.logs")}</TabsTrigger>
          </TabsList>

          <TabsContent value="configs">
            <ChannelsTab />
          </TabsContent>

          <TabsContent value="logs">
            <LogsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
