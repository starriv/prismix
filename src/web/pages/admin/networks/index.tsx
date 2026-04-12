import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Plus } from "lucide-react";

import { useAdminAllowedTokens, useAdminNetworks } from "@/web/api/admin-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";

import { AddNetworkDialog } from "./add-network-dialog";
import { NetworkCardGrid } from "./network-card-grid";

export default function AdminNetworksPage() {
  const { t } = useTranslation();
  const { data: networks = [] } = useAdminNetworks();
  const { data: tokens = [] } = useAdminAllowedTokens();
  const [addOpen, setAddOpen] = useState(false);

  const tokensByNetwork = (networkId: string) => tokens.filter((tk) => tk.network === networkId);
  const mainnets = networks.filter((n) => !n.testnet);
  const testnets = networks.filter((n) => n.testnet);
  return (
    <div>
      <Header title={t("admin.networks.title")} description={t("admin.networks.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("admin.networks.btn.add")}
          </Button>
        </div>

        {networks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            {t("admin.networks.empty")}
          </p>
        ) : (
          <Tabs defaultValue="mainnet">
            <TabsList className="w-full">
              <TabsTrigger value="mainnet" className="flex-1">
                {t("common.mainnet")} ({mainnets.length})
              </TabsTrigger>
              <TabsTrigger value="testnet" className="flex-1">
                {t("common.testnet")} ({testnets.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="mainnet">
              <NetworkCardGrid networks={mainnets} tokensByNetwork={tokensByNetwork} />
            </TabsContent>
            <TabsContent value="testnet">
              <NetworkCardGrid networks={testnets} tokensByNetwork={tokensByNetwork} />
            </TabsContent>
          </Tabs>
        )}

        <p className="text-xs text-muted-foreground">{t("admin.networks.hint")}</p>
      </div>

      <AddNetworkDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
