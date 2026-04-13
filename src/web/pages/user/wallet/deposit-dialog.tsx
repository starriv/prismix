import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { queryKeys } from "@/web/api/query-keys";
import {
  useCreateWalletTopup,
  useVerifyDeposit,
  useWalletDepositInfo,
  useWalletTopupOrder,
} from "@/web/api/user-hooks";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

export function DepositDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: depositInfo } = useWalletDepositInfo(open);
  const createTopup = useCreateWalletTopup();
  const verifyDeposit = useVerifyDeposit();
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [network, setNetwork] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const topupOrder = useWalletTopupOrder(orderId, open);

  const activeOrder = topupOrder.data;
  const depositAddress = activeOrder?.toAddress ?? depositInfo?.address ?? "";
  const selectedNetwork = useMemo(
    () => depositInfo?.networks.find((net) => net.networkId === network),
    [depositInfo, network],
  );

  const resetDialog = useCallback(() => {
    setAmount("");
    setTxHash("");
    setNetwork("");
    setOrderId(null);
    setCopied(false);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetDialog();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetDialog],
  );

  useEffect(() => {
    if (topupOrder.data?.status !== "confirmed") return;

    qc.invalidateQueries({ queryKey: queryKeys.userWallet() });
    qc.invalidateQueries({ queryKey: queryKeys.userWalletTransactions() });
    toast.success(t("user.wallet.deposit-auto-confirmed", { amount: topupOrder.data.amount }));
    const timer = window.setTimeout(() => {
      handleOpenChange(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [topupOrder.data?.amount, topupOrder.data?.status, qc, t, handleOpenChange]);

  const handleCopy = useCallback(async () => {
    if (!depositAddress) return;
    await navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t("user.wallet.deposit-copied"));
  }, [depositAddress, t]);

  const handleCreateTopup = useCallback(async () => {
    if (!amount || !network) return;
    try {
      const order = await createTopup.mutateAsync({ amount, network });
      setOrderId(order.id);
      toast.success(t("user.wallet.deposit-order-created"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.wallet.deposit-order-failed"));
    }
  }, [amount, network, createTopup, t]);

  const handleVerify = useCallback(async () => {
    if (!txHash || !network) return;
    try {
      const result = await verifyDeposit.mutateAsync({ txHash, network });
      toast.success(t("user.wallet.deposit-verified", { amount: result.amount }));
      setTxHash("");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.wallet.deposit-failed"));
    }
  }, [txHash, network, verifyDeposit, t, handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.wallet.deposit-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("user.wallet.deposit-desc")}</p>

          <div className="space-y-2">
            <Label>{t("user.wallet.deposit-network")}</Label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("user.wallet.deposit-network")} />
              </SelectTrigger>
              <SelectContent>
                {depositInfo?.networks.map((net) => (
                  <SelectItem key={net.networkId} value={net.networkId}>
                    {net.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("user.wallet.withdraw-amount")}</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("user.wallet.withdraw-amount-ph")}
              inputMode="decimal"
            />
          </div>

          <Button
            onClick={handleCreateTopup}
            disabled={!amount || !network || createTopup.isPending}
            className="w-full"
          >
            {createTopup.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t("user.wallet.deposit-create-order")}
          </Button>

          {/* Deposit Address */}
          {depositAddress && (
            <div className="space-y-2">
              <Label>{t("user.wallet.deposit-address")}</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={depositAddress} className="font-mono text-xs" />
                <Button variant="ghost" size="icon" className="shrink-0" onClick={handleCopy}>
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {selectedNetwork && (
            <div className="space-y-2">
              <Label>{t("user.wallet.deposit-token")}</Label>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  {selectedNetwork.name}
                </Badge>
                <Badge variant="outline" className="text-xs font-mono">
                  USDC: {selectedNetwork.usdcAddress.slice(0, 6)}…
                  {selectedNetwork.usdcAddress.slice(-4)}
                </Badge>
              </div>
            </div>
          )}

          {activeOrder && (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <p>{t("user.wallet.deposit-order-active", { amount: activeOrder.amount })}</p>
              <p>{t("user.wallet.deposit-order-expiry")}</p>
            </div>
          )}

          {/* Manual Verification */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{t("user.wallet.deposit-manual")}</p>
            <p className="text-xs text-muted-foreground">{t("user.wallet.deposit-manual-desc")}</p>
            <div className="space-y-2">
              <Input
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder={t("user.wallet.deposit-txhash-ph")}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            onClick={handleVerify}
            disabled={!txHash || !network || verifyDeposit.isPending || createTopup.isPending}
          >
            {verifyDeposit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            <Search className="mr-1 h-3.5 w-3.5" />
            {t("user.wallet.deposit-verify")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
