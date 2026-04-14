import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, Wallet2 } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import type { UserWalletTopupOrder } from "@/web/api/schemas";
import { useUserWallet, useWalletDepositInfo } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { Skeleton } from "@/web/components/ui/skeleton";
import { WalletAddress } from "@/web/components/ui/wallet-address";
import { useChainRegistry } from "@/web/shared/chains";

import { DepositDialog } from "./deposit-dialog";
import { FiatOrderDialog, FiatPendingTopupDialog } from "./fiat-order-dialog";
import { PendingWithdrawals } from "./pending-withdrawals";
import { WalletTopupOrders } from "./topup-orders";
import { WithdrawDialog } from "./withdraw-dialog";

const CLOSE_DELAY_MS = 120;

function WalletActionPopover({
  label,
  icon,
  variant,
  disabled,
  cryptoLabel,
  fiatLabel,
  cryptoDesc,
  fiatDesc,
  onCrypto,
  onFiat,
}: {
  label: string;
  icon: ReactNode;
  variant?: "default" | "outline";
  disabled?: boolean;
  cryptoLabel: string;
  fiatLabel: string;
  cryptoDesc: string;
  fiatDesc: string;
  onCrypto: () => void;
  onFiat: () => void;
}) {
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return () => clearTimeout(closeTimer.current);
  }, []);

  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  const handleSelect = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={variant}
          disabled={disabled}
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
          onClick={() => {
            cancelClose();
            setOpen((value) => !value);
          }}
        >
          {icon}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] rounded-xl border-border/70 p-3 shadow-xl"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="space-y-3">
          <div className="px-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </p>
          </div>

          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50"
            onClick={() => handleSelect(onCrypto)}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <Wallet2 className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{cryptoLabel}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {cryptoDesc}
              </span>
            </span>
          </button>

          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50"
            onClick={() => handleSelect(onFiat)}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
              <Landmark className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{fiatLabel}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{fiatDesc}</span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function UserWalletPage() {
  const { t } = useTranslation();
  const { data: wallet, isLoading } = useUserWallet();
  const { data: depositInfo } = useWalletDepositInfo();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [fiatDepositOpen, setFiatDepositOpen] = useState(false);
  const [fiatWithdrawOpen, setFiatWithdrawOpen] = useState(false);
  const [selectedTopupOrderId, setSelectedTopupOrderId] = useState<number | null>(null);
  const [selectedFiatTopupOrderId, setSelectedFiatTopupOrderId] = useState<number | null>(null);

  const handleDeposit = useCallback(() => {
    setSelectedTopupOrderId(null);
    setDepositOpen(true);
  }, []);

  const handleOpenPendingTopup = useCallback((order: UserWalletTopupOrder) => {
    if (order.type === "fiat") {
      setSelectedFiatTopupOrderId(order.id);
      setFiatDepositOpen(true);
      return;
    }
    setSelectedTopupOrderId(order.id);
    setDepositOpen(true);
  }, []);

  const handleWithdraw = useCallback(() => {
    setWithdrawOpen(true);
  }, []);

  const handleFiatDeposit = useCallback(() => {
    setSelectedTopupOrderId(null);
    setSelectedFiatTopupOrderId(null);
    setFiatDepositOpen(true);
  }, []);

  const handleFiatWithdraw = useCallback(() => {
    setFiatWithdrawOpen(true);
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
                <WalletActionPopover
                  label={t("user.wallet.deposit")}
                  icon={<ArrowDownLeft className="mr-1 h-3.5 w-3.5" />}
                  disabled={isLoading}
                  cryptoLabel={t("user.wallet.selector-crypto")}
                  fiatLabel={t("user.wallet.selector-fiat")}
                  cryptoDesc={t("user.wallet.selector-deposit-crypto-desc")}
                  fiatDesc={t("user.wallet.selector-deposit-fiat-desc")}
                  onCrypto={handleDeposit}
                  onFiat={handleFiatDeposit}
                />
                <WalletActionPopover
                  label={t("user.wallet.withdraw")}
                  icon={<ArrowUpRight className="mr-1 h-3.5 w-3.5" />}
                  variant="outline"
                  disabled={isLoading}
                  cryptoLabel={t("user.wallet.selector-crypto")}
                  fiatLabel={t("user.wallet.selector-fiat")}
                  cryptoDesc={t("user.wallet.selector-withdraw-crypto-desc")}
                  fiatDesc={t("user.wallet.selector-withdraw-fiat-desc")}
                  onCrypto={handleWithdraw}
                  onFiat={handleFiatWithdraw}
                />
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

        <FiatOrderDialog
          mode="deposit"
          open={fiatDepositOpen && selectedFiatTopupOrderId === null}
          onOpenChange={(nextOpen) => {
            setFiatDepositOpen(nextOpen);
            if (!nextOpen) setSelectedFiatTopupOrderId(null);
          }}
        />
        <FiatOrderDialog
          mode="withdraw"
          open={fiatWithdrawOpen}
          onOpenChange={setFiatWithdrawOpen}
          maxBalance={wallet?.balance ?? "0"}
        />
        <FiatPendingTopupDialog
          open={fiatDepositOpen && selectedFiatTopupOrderId !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setFiatDepositOpen(false);
              setSelectedFiatTopupOrderId(null);
            }
          }}
          orderId={selectedFiatTopupOrderId}
        />
      </div>
    </div>
  );
}
