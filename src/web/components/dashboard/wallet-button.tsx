import { useTranslation } from "react-i18next";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import { Button } from "@/web/components/ui/button";

export function WalletButton() {
  const { t } = useTranslation();

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              style: { opacity: 0, pointerEvents: "none" as const, userSelect: "none" as const },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <Button variant="default" size="sm" onClick={openConnectModal}>
                    {t("common.connect-wallet")}
                  </Button>
                );
              }

              if (chain.unsupported) {
                return (
                  <Button variant="destructive" size="sm" onClick={openChainModal}>
                    {t("common.wallet.wrong-network")}
                  </Button>
                );
              }

              return (
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={openChainModal} className="gap-1.5">
                    {chain.hasIcon && chain.iconUrl && (
                      <img
                        alt={chain.name ?? "Chain"}
                        src={chain.iconUrl}
                        className="size-3.5 rounded-full"
                      />
                    )}
                    <span className="text-xs">{chain.name}</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={openAccountModal}>
                    <span className="font-mono text-xs">
                      {`${account.address.slice(0, 6)}…${account.address.slice(-4)}`}
                    </span>
                  </Button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
