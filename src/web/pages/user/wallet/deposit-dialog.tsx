import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Copy, ExternalLink, Loader2, Search } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { MIN_TOPUP_AMOUNT, SETTLEMENT_DECIMALS, TOKEN_SYMBOL } from "@/shared/tokens";
import { ApiError } from "@/web/api/create-api-client";
import { queryKeys } from "@/web/api/query-keys";
import {
  useCreateWalletTopup,
  useVerifyDeposit,
  useWalletDepositInfo,
  useWalletTopupOrder,
  useWalletTopupOrders,
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
import { useTheme } from "@/web/providers/theme-provider";
import { explorerAddressUrl, useChainRegistry } from "@/web/shared/chains";
import { cn } from "@/web/shared/utils";

type DepositStep = "create" | "verify" | "result";

const MIN_TOPUP_AMOUNT_NUM = Number(MIN_TOPUP_AMOUNT);
const AMOUNT_PRECISION_RE = new RegExp(`^\\d+(\\.\\d{0,${SETTLEMENT_DECIMALS}})?$`);
const QUICK_TOPUP_AMOUNTS = ["5", "10", "50", "100"] as const;

const DEPOSIT_STEPS: Array<{ key: DepositStep; order: 1 | 2 | 3; labelKey: string }> = [
  { key: "create", order: 1, labelKey: "user.wallet.deposit-step-create" },
  { key: "verify", order: 2, labelKey: "user.wallet.deposit-step-verify" },
  { key: "result", order: 3, labelKey: "user.wallet.deposit-step-result" },
];

function StepIndicator({
  currentStep,
  t,
}: {
  currentStep: DepositStep;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      {DEPOSIT_STEPS.map((step, i) => {
        const isCompleted =
          (currentStep === "verify" && step.key === "create") ||
          (currentStep === "result" && step.key !== "result");
        const isActive = currentStep === step.key;

        return (
          <div key={step.key} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-colors",
                isCompleted
                  ? "border-foreground bg-foreground text-background"
                  : isActive
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground",
              )}
            >
              {isCompleted ? <Check className="h-3 w-3" /> : step.order}
            </div>
            <span
              className={cn(
                "text-xs",
                isCompleted
                  ? "font-medium text-foreground"
                  : isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {t(step.labelKey)}
            </span>
            {i < DEPOSIT_STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function StatusNotice({
  status,
  amount,
  restartLabel,
  onRestart,
  t,
}: {
  status: "confirmed" | "expired" | "rejected";
  amount?: string | null;
  restartLabel: string;
  onRestart: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const tone =
    status === "confirmed"
      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <div className={cn("space-y-3 rounded-lg border p-4", tone)}>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(`topup.status.${status}`)}</p>
        <p className="text-xs opacity-90">
          {status === "confirmed"
            ? t("user.wallet.deposit-auto-confirmed", { amount: amount ?? "0" })
            : t("user.wallet.deposit-order-ended")}
        </p>
      </div>
      {status !== "confirmed" && (
        <Button type="button" variant="outline" onClick={onRestart}>
          {restartLabel}
        </Button>
      )}
    </div>
  );
}

export function DepositDialog({
  open,
  onOpenChange,
  initialOrderId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialOrderId?: number | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const { resolvedTheme } = useTheme();
  const { data: depositInfo } = useWalletDepositInfo(open);
  const createTopup = useCreateWalletTopup();
  const verifyDeposit = useVerifyDeposit();
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [network, setNetwork] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissedInitialOrder, setDismissedInitialOrder] = useState(false);
  const [verifiedResult, setVerifiedResult] = useState<{ amount: string; network: string } | null>(
    null,
  );
  const pendingOrders = useWalletTopupOrders({
    status: "pending",
    limit: 1,
    enabled: open,
  });
  const resolvedOrderId = orderId ?? (dismissedInitialOrder ? null : initialOrderId) ?? null;
  const topupOrder = useWalletTopupOrder(resolvedOrderId, open);

  const activeOrder = topupOrder.data ?? null;
  const blockingPendingOrder =
    pendingOrders.data?.find((pendingOrder) => pendingOrder.status === "pending") ?? null;
  const effectiveNetwork = activeOrder?.network ?? network;
  const depositAddress = activeOrder?.toAddress ?? depositInfo?.address ?? "";
  const selectedNetwork = useMemo(
    () => depositInfo?.networks.find((net) => net.networkId === effectiveNetwork),
    [depositInfo, effectiveNetwork],
  );
  const explorerUrl = useMemo(
    () =>
      effectiveNetwork ? getChainDisplayByNetworkId(effectiveNetwork)?.explorerUrl : undefined,
    [effectiveNetwork, getChainDisplayByNetworkId],
  );
  const explorerAddressHref = explorerUrl ? explorerAddressUrl(explorerUrl, depositAddress) : null;
  const qrValue = useMemo(() => depositAddress.trim(), [depositAddress]);
  const qrPanelBg = resolvedTheme === "dark" ? "#e4e4e7" : "#ffffff";
  const confirmedRef = useRef<number | null>(null);
  const parsedAmount = Number(amount);
  const hasValidPrecision = amount.trim().length === 0 || AMOUNT_PRECISION_RE.test(amount.trim());
  const isAmountValid =
    amount.trim().length > 0 &&
    hasValidPrecision &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= MIN_TOPUP_AMOUNT_NUM;
  const showAmountError = amountTouched && amount.trim().length > 0 && !isAmountValid;

  const resetDialog = useCallback(() => {
    setAmount("");
    setAmountTouched(false);
    setTxHash("");
    setNetwork("");
    setOrderId(null);
    setCopied(false);
    setDismissedInitialOrder(false);
    setVerifiedResult(null);
    confirmedRef.current = null;
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetDialog();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetDialog],
  );

  useEffect(() => {
    const data = topupOrder.data;
    if (data?.status !== "confirmed" || !data.id) return;
    if (confirmedRef.current === data.id) return;
    confirmedRef.current = data.id;

    qc.invalidateQueries({ queryKey: queryKeys.userWallet() });
    qc.invalidateQueries({ queryKey: queryKeys.userWalletTransactions() });
    toast.success(t("user.wallet.deposit-auto-confirmed", { amount: data.amount }));
  }, [topupOrder.data?.id, topupOrder.data?.status, topupOrder.data?.amount, qc, t]);

  const handleCopy = useCallback(async () => {
    if (!depositAddress) return;
    await navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t("user.wallet.deposit-copied"));
  }, [depositAddress, t]);

  const handleAmountChange = useCallback((value: string) => {
    if (value === "") {
      setAmount("");
      return;
    }

    if (!/^\d*\.?\d*$/.test(value)) return;

    const [integerPart, decimalPart] = value.split(".");
    if (decimalPart && decimalPart.length > SETTLEMENT_DECIMALS) return;

    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
    setAmount(
      decimalPart !== undefined ? `${normalizedInteger}.${decimalPart}` : normalizedInteger,
    );
  }, []);

  const handleCreateTopup = useCallback(async () => {
    if (!amount || !network) return;
    if (!isAmountValid) {
      toast.error(t("user.wallet.deposit-min-amount", { amount: MIN_TOPUP_AMOUNT }));
      return;
    }
    try {
      const order = await createTopup.mutateAsync({ amount, network });
      setOrderId(order.id);
      toast.success(t("user.wallet.deposit-order-created"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await pendingOrders.refetch();
      }
      toast.error(err instanceof Error ? err.message : t("user.wallet.deposit-order-failed"));
    }
  }, [amount, network, createTopup, isAmountValid, t, pendingOrders.refetch]);

  const handleVerify = useCallback(async () => {
    if (!txHash || !effectiveNetwork) return;
    try {
      const result = await verifyDeposit.mutateAsync({ txHash, network: effectiveNetwork });
      toast.success(t("user.wallet.deposit-verified", { amount: result.amount }));
      setTxHash("");
      setVerifiedResult({ amount: result.amount, network: effectiveNetwork });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.wallet.deposit-failed"));
    }
  }, [txHash, effectiveNetwork, verifyDeposit, t]);

  const handleRestart = useCallback(() => {
    setAmount("");
    setAmountTouched(false);
    setNetwork("");
    setTxHash("");
    setOrderId(null);
    setDismissedInitialOrder(true);
  }, []);

  const displayResult =
    verifiedResult ??
    (activeOrder?.status === "confirmed" && activeOrder.network
      ? { amount: activeOrder.amount, network: activeOrder.network }
      : null);
  const currentStep: DepositStep = displayResult ? "result" : activeOrder ? "verify" : "create";
  const showVerifyStep = currentStep === "verify";
  const showResultStep = currentStep === "result";
  const isOrderEnded = activeOrder?.status === "expired" || activeOrder?.status === "rejected";
  const showBlockingPendingPrompt = !resolvedOrderId && !showResultStep && !!blockingPendingOrder;
  const resultNetwork = useMemo(
    () => depositInfo?.networks.find((net) => net.networkId === displayResult?.network),
    [depositInfo, displayResult?.network],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (showResultStep) {
        handleOpenChange(false);
        return;
      }
      if (showVerifyStep) {
        if (isOrderEnded) {
          handleRestart();
          return;
        }
        await handleVerify();
        return;
      }
      if (showBlockingPendingPrompt) return;
      await handleCreateTopup();
    },
    [
      showResultStep,
      handleOpenChange,
      showVerifyStep,
      isOrderEnded,
      handleRestart,
      handleVerify,
      showBlockingPendingPrompt,
      handleCreateTopup,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.wallet.deposit-title")}</DialogTitle>
          <StepIndicator currentStep={currentStep} t={t} />
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <div className="min-h-80 space-y-4">
              <div className={currentStep !== "create" ? "hidden" : "space-y-4"}>
                {showBlockingPendingPrompt ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300">
                    <p className="text-sm font-medium">
                      {t("user.wallet.deposit-pending-block-title")}
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                      {t("user.wallet.deposit-pending-block-desc", {
                        orderId: blockingPendingOrder?.id ?? "",
                      })}
                    </p>
                  </div>
                ) : null}

                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t("user.wallet.deposit-step-create-title")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("user.wallet.deposit-step-create-desc")}
                  </p>
                </div>

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
                  <div className="relative">
                    <Input
                      value={amount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      onBlur={() => setAmountTouched(true)}
                      placeholder={t("user.wallet.withdraw-amount-ph")}
                      inputMode="decimal"
                      aria-invalid={showAmountError}
                      className={cn(
                        "pr-14",
                        showAmountError && "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                      {TOKEN_SYMBOL}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("user.wallet.deposit-min-amount-hint", {
                      amount: MIN_TOPUP_AMOUNT,
                      decimals: SETTLEMENT_DECIMALS,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {QUICK_TOPUP_AMOUNTS.map((quickAmount) => (
                      <Button
                        key={quickAmount}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-3"
                        onClick={() => {
                          setAmount(quickAmount);
                          setAmountTouched(true);
                        }}
                      >
                        {quickAmount} {TOKEN_SYMBOL}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={!showVerifyStep ? "hidden" : "space-y-4"}>
                {isOrderEnded && activeOrder ? (
                  <StatusNotice
                    status={activeOrder.status as "expired" | "rejected"}
                    amount={activeOrder.amount}
                    restartLabel={t("user.wallet.deposit-create-new-order")}
                    onRestart={handleRestart}
                    t={t}
                  />
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {t("user.wallet.deposit-step-verify-title")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("user.wallet.deposit-step-verify-desc")}
                      </p>
                    </div>

                    {depositAddress && (
                      <div className="rounded-2xl border bg-linear-to-b from-muted/40 to-muted/10 p-4">
                        <div className="space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">
                                {t("user.wallet.deposit-qr-card-title")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("user.wallet.deposit-qr-card-desc")}
                              </p>
                            </div>
                            {selectedNetwork && (
                              <Badge variant="outline" className="shrink-0 text-[11px]">
                                {selectedNetwork.name}
                              </Badge>
                            )}
                          </div>

                          <div className="flex justify-center">
                            <div className="rounded-[28px] bg-white p-4 dark:bg-zinc-200">
                              <QRCodeSVG
                                value={qrValue}
                                size={180}
                                marginSize={2}
                                bgColor={qrPanelBg}
                                fgColor="#111111"
                                title={t("user.wallet.deposit-qr-title")}
                              />
                            </div>
                          </div>

                          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {t("user.wallet.deposit-result-network")}
                              </p>
                              <p className="text-sm font-medium">{selectedNetwork?.name ?? "--"}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {t("user.wallet.deposit-result-amount")}
                              </p>
                              <p className="text-sm font-medium">
                                {(activeOrder?.amount ?? amount) || "--"} USDC
                              </p>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              {t("user.wallet.deposit-view-address")}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              {explorerAddressHref ? (
                                <a
                                  href={explorerAddressHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-1 break-all font-mono text-xs text-foreground underline underline-offset-4 decoration-foreground/40 transition-colors hover:text-foreground hover:decoration-foreground"
                                >
                                  {depositAddress}
                                </a>
                              ) : (
                                <p className="flex-1 break-all font-mono text-xs text-foreground underline underline-offset-4 decoration-foreground/30">
                                  {depositAddress}
                                </p>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0"
                                onClick={handleCopy}
                              >
                                {copied ? (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              {explorerAddressHref ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  asChild
                                >
                                  <a
                                    href={explorerAddressHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t("common.a11y.external-link")}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeOrder && (
                      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        <p>
                          {t("user.wallet.deposit-order-active", { amount: activeOrder.amount })}
                        </p>
                      </div>
                    )}

                    <div className="space-y-2 border-t pt-4">
                      <p className="text-sm font-medium">{t("user.wallet.deposit-manual")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("user.wallet.deposit-manual-desc")}
                      </p>
                      <Input
                        value={txHash}
                        onChange={(e) => setTxHash(e.target.value)}
                        placeholder={t("user.wallet.deposit-txhash-ph")}
                        className="font-mono text-xs"
                      />
                    </div>
                  </>
                )}
              </div>

              <div
                className={!showResultStep ? "hidden" : "flex min-h-80 items-center justify-center"}
              >
                <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
                    <Check className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-medium">
                    {t("user.wallet.deposit-result-summary", {
                      amount: displayResult?.amount ?? "0",
                    })}
                  </p>
                  <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">
                        {t("user.wallet.deposit-result-network")}
                      </p>
                      <p className="text-sm font-medium text-right">
                        {resultNetwork?.name ?? displayResult?.network ?? "--"}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">
                        {t("user.wallet.deposit-result-amount")}
                      </p>
                      <p className="text-sm font-medium text-right">
                        {displayResult?.amount ?? "--"} USDC
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("common.btn.cancel")}
            </Button>
            {showResultStep ? (
              <Button type="submit">{t("common.btn.done")}</Button>
            ) : !showVerifyStep ? (
              <Button
                type="submit"
                disabled={
                  showBlockingPendingPrompt || !network || !isAmountValid || createTopup.isPending
                }
              >
                {createTopup.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                <ArrowRight className="mr-1 h-3.5 w-3.5" />
                {t("user.wallet.deposit-create-order")}
              </Button>
            ) : isOrderEnded ? (
              <Button type="submit">{t("user.wallet.deposit-create-new-order")}</Button>
            ) : (
              <Button
                type="submit"
                disabled={
                  !txHash || !effectiveNetwork || verifyDeposit.isPending || createTopup.isPending
                }
              >
                {verifyDeposit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                <Search className="mr-1 h-3.5 w-3.5" />
                {t("user.wallet.deposit-verify")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
