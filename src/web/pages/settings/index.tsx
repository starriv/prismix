import { useTranslation } from "react-i18next";

import { Header } from "@/web/components/dashboard/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";

import { ApiKeysTab } from "./api-keys-tab";
import { GeneralTab } from "./general-tab";

export default function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div>
      <Header title={t("settings.title")} description={t("settings.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">{t("settings.tab.general")}</TabsTrigger>
            <TabsTrigger value="api-keys">{t("settings.tab.api-keys")}</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="api-keys">
            <ApiKeysTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
