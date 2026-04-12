import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { useVerifyDeposit, useWalletDepositInfo } from "@/web/api/user-hooks";
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
  const { data: depositInfo } = useWalletDepositInfo(open);
  const verifyDeposit = useVerifyDeposit();
  const [txHash, setTxHash] = useState("");
  const [network, setNetwork] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!depositInfo?.address) return;
    await navigator.clipboard.writeText(depositInfo.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t("user.wallet.deposit-copied"));
  }, [depositInfo, t]);

  const handleVerify = useCallback(async () => {
    if (!txHash || !network) return;
    try {
      const result = await verifyDeposit.mutateAsync({ txHash, network });
      toast.success(t("user.wallet.deposit-verified", { amount: result.amount }));
      setTxHash("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.wallet.deposit-failed"));
    }
  }, [txHash, network, verifyDeposit, t, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.wallet.deposit-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("user.wallet.deposit-desc")}</p>

          {/* Deposit Address */}
          {depositInfo?.address && (
            <div className="space-y-2">
              <Label>{t("user.wallet.deposit-address")}</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={depositInfo.address} className="font-mono text-xs" />
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

          {/* Supported Networks */}
          {depositInfo?.networks && depositInfo.networks.length > 0 && (
            <div className="space-y-2">
              <Label>{t("user.wallet.deposit-network")}</Label>
              <div className="flex flex-wrap gap-2">
                {depositInfo.networks.map((net) => (
                  <Badge key={net.networkId} variant="outline" className="text-xs">
                    {net.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Manual Verification */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{t("user.wallet.deposit-manual")}</p>
            <p className="text-xs text-muted-foreground">{t("user.wallet.deposit-manual-desc")}</p>
            <div className="space-y-2">
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleVerify} disabled={!txHash || !network || verifyDeposit.isPending}>
            {verifyDeposit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            <Search className="mr-1 h-3.5 w-3.5" />
            {t("user.wallet.deposit-verify")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
