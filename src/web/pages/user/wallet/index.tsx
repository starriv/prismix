import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import type { UserWalletTopupOrder } from "@/web/api/schemas";
import { useUserWallet, useWalletDepositInfo } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { WalletAddress } from "@/web/components/ui/wallet-address";
import { useChainRegistry } from "@/web/shared/chains";

import { DepositDialog } from "./deposit-dialog";
import { PendingWithdrawals } from "./pending-withdrawals";
import { WalletTopupOrders } from "./topup-orders";
import { WithdrawDialog } from "./withdraw-dialog";

export default function UserWalletPage() {
  const { t } = useTranslation();
  const { data: wallet, isLoading } = useUserWallet();
  const { data: depositInfo } = useWalletDepositInfo();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [selectedTopupOrderId, setSelectedTopupOrderId] = useState<number | null>(null);

  const handleDeposit = useCallback(() => {
    setSelectedTopupOrderId(null);
    setDepositOpen(true);
  }, []);

  const handleOpenPendingTopup = useCallback((order: UserWalletTopupOrder) => {
    setSelectedTopupOrderId(order.id);
    setDepositOpen(true);
  }, []);

  const handleWithdraw = useCallback(() => {
    setWithdrawOpen(true);
  }, []);

  const defaultExplorerUrl = useMemo(() => {
    const networkId = depositInfo?.networks[0]?.networkId;
    if (!networkId) return undefined;
    return getChainDisplayByNetworkId(networkId)?.explorerUrl;
  }, [depositInfo, getChainDisplayByNetworkId]);

  return (
    <div>
      <Header title={t("user.wallet.title")} description={t("user.wallet.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        {/* Hero Balance Card */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{t("user.wallet.balance")}</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-32 mt-1" />
                ) : (
                  <p className="text-2xl font-bold">
                    ${removeTailingZero(wallet?.balance ?? "0")}{" "}
                    <span className="text-sm text-muted-foreground">USDC</span>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleDeposit} disabled={isLoading}>
                  <ArrowDownLeft className="mr-1 h-3.5 w-3.5" />
                  {t("user.wallet.deposit")}
                </Button>
                <Button size="sm" variant="outline" onClick={handleWithdraw} disabled={isLoading}>
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                  {t("user.wallet.withdraw")}
                </Button>
              </div>
            </div>

            {/* Wallet address with copy + explorer */}
            {wallet?.address && (
              <WalletAddress address={wallet.address} explorerUrl={defaultExplorerUrl} />
            )}
          </CardContent>
        </Card>

        {/* Deposit Orders */}
        <WalletTopupOrders onSelectOrder={handleOpenPendingTopup} />

        {/* Withdrawal Orders */}
        <PendingWithdrawals />

        {/* Deposit Dialog */}
        <DepositDialog
          open={depositOpen}
          onOpenChange={setDepositOpen}
          initialOrderId={selectedTopupOrderId}
        />

        {/* Withdraw Dialog */}
        <WithdrawDialog
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          maxBalance={wallet?.balance ?? "0"}
        />
      </div>
    </div>
  );
}
