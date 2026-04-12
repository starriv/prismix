import { useTranslation } from "react-i18next";

import type { SupportedNetwork } from "@/web/api/schemas";

import { NetworkCard } from "./network-card";

export function NetworkCardGrid({
  networks,
  tokensByNetwork,
}: {
  networks: SupportedNetwork[];
  tokensByNetwork: (networkId: string) => { symbol: string }[];
}) {
  const { t } = useTranslation();

  if (networks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">{t("admin.networks.empty")}</p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {networks.map((net) => (
        <NetworkCard
          key={net.id}
          network={net}
          tokenSymbols={tokensByNetwork(net.networkId).map((tk) => tk.symbol)}
        />
      ))}
    </div>
  );
}
