import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { useCreateWithdraw, useWalletDepositInfo } from "@/web/api/user-hooks";
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

export function WithdrawDialog({
  open,
  onOpenChange,
  maxBalance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxBalance: string;
}) {
  const { t } = useTranslation();
  const { data: depositInfo } = useWalletDepositInfo(open);
  const createWithdraw = useCreateWithdraw();
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [isWithdrawAll, setIsWithdrawAll] = useState(false);
  const [network, setNetwork] = useState("");

  const handleMax = useCallback(() => {
    setAmount(removeTailingZero(maxBalance));
    setIsWithdrawAll(true);
  }, [maxBalance]);

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
    setIsWithdrawAll(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!toAddress || !amount || !network) return;
    try {
      await createWithdraw.mutateAsync(
        isWithdrawAll ? { toAddress, withdrawAll: true, network } : { toAddress, amount, network },
      );
      toast.success(t("user.wallet.withdraw-success"));
      setToAddress("");
      setAmount("");
      setIsWithdrawAll(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.wallet.withdraw-failed"));
    }
  }, [toAddress, amount, isWithdrawAll, network, createWithdraw, t, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.wallet.withdraw-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("user.wallet.withdraw-desc")}</p>

          <div className="space-y-2">
            <Label>{t("user.wallet.withdraw-network")}</Label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("user.wallet.withdraw-network")} />
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
            <Label>{t("user.wallet.withdraw-address")}</Label>
            <Input
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder={t("user.wallet.withdraw-address-ph")}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("user.wallet.withdraw-amount")}</Label>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleMax}>
                {t("user.wallet.withdraw-max")}: ${removeTailingZero(maxBalance)}
              </Button>
            </div>
            <Input
              value={amount}
              onChange={handleAmountChange}
              placeholder={t("user.wallet.withdraw-amount-ph")}
              type="text"
              inputMode="decimal"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!toAddress || !amount || !network || createWithdraw.isPending}
          >
            {createWithdraw.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t("user.wallet.withdraw-confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
