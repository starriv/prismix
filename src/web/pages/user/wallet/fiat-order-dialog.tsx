import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import {
  useCreateWalletTopup,
  useCreateWithdraw,
  useSubmitFiatTopupProof,
  useWalletFiatConfigs,
  useWalletTopupOrder,
} from "@/web/api/user-hooks";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";
import { Textarea } from "@/web/components/ui/textarea";
import { safeParseConfig } from "@/web/pages/fiat-configs/constants";

type Mode = "deposit" | "withdraw";

const SAFE_IMAGE_MIME_RE = /^data:image\/(png|jpeg|gif|webp);base64,/;

function isImageSource(value: string) {
  return (
    /^data:image\/(png|jpeg|gif|webp);base64,/.test(value) ||
    /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(value)
  );
}

function ConfigDetails({
  config,
  t,
}: {
  config: Record<string, string>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const labelMap: Record<string, string> = {
    currency: t("fiat.form.currency"),
    bankName: t("fiat.form.bank-name"),
    accountName: t("fiat.form.account-name"),
    accountNumber: t("fiat.form.account-number"),
    accountId: t("fiat.form.account-id"),
    qrCodeUrl: t("fiat.form.qr-code-url"),
    email: t("fiat.form.email"),
    note: t("fiat.form.note"),
  };
  const note = config.note?.trim();
  const items = Object.entries(config).filter(([key, value]) => key !== "note" && value);
  if (items.length === 0) {
    if (!note) {
      return <p className="text-xs text-muted-foreground">{t("user.wallet.fiat-config-empty")}</p>;
    }

    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("fiat.form.note")}</p>
        <p className="text-sm leading-6">{note}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <p className="text-xs text-muted-foreground">{labelMap[key] ?? key}</p>
          {key === "qrCodeUrl" ? (
            isImageSource(value) ? (
              <div className="space-y-3">
                <div className="flex justify-center rounded-xl border border-border/70 bg-muted/20 p-4">
                  <img
                    src={value}
                    alt={t("fiat.form.qr-code-preview-alt")}
                    className="max-h-64 rounded-lg object-contain"
                  />
                </div>
                {!value.startsWith("data:image/") ? (
                  <a
                    href={value}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary underline-offset-2 hover:underline"
                  >
                    {t("fiat.form.qr-code-open")}
                  </a>
                ) : null}
              </div>
            ) : (
              <a
                href={value}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-primary underline-offset-2 hover:underline"
              >
                {value}
              </a>
            )
          ) : (
            <p className="break-all text-base font-medium">{value}</p>
          )}
        </div>
      ))}
      {note ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("fiat.form.note")}</p>
          <p className="text-sm leading-6">{note}</p>
        </div>
      ) : null}
    </div>
  );
}

export function FiatOrderDialog({
  mode,
  open,
  onOpenChange,
  maxBalance = "0",
}: {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxBalance?: string;
}) {
  const { t } = useTranslation();
  const { data: configs = [] } = useWalletFiatConfigs(open && mode === "deposit");
  const createTopup = useCreateWalletTopup();
  const createWithdraw = useCreateWithdraw();
  const [activeConfigId, setActiveConfigId] = useState("");
  const [amount, setAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("");
  const [payoutInfo, setPayoutInfo] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");

  const enabledConfigs = useMemo(() => configs.filter((cfg) => cfg.enabled), [configs]);
  const activeConfig =
    enabledConfigs.find((cfg) => String(cfg.id) === activeConfigId) ?? enabledConfigs[0] ?? null;

  useEffect(() => {
    if (!open) {
      setAmount("");
      setActiveConfigId("");
      setWithdrawMethod("");
      setPayoutInfo("");
      setWithdrawNote("");
      return;
    }
    if (!activeConfigId && enabledConfigs[0]) {
      setActiveConfigId(String(enabledConfigs[0].id));
    }
  }, [open, enabledConfigs, activeConfigId]);

  const handleMaxAmount = useCallback(() => {
    setAmount(removeTailingZero(maxBalance));
  }, [maxBalance]);

  const handleSubmit = useCallback(async () => {
    if (!amount) return;

    try {
      if (mode === "deposit") {
        if (!activeConfig) return;
        await createTopup.mutateAsync({
          type: "fiat",
          amount,
          fiatConfigId: activeConfig.id,
        });
        toast.success(t("user.wallet.fiat-deposit-success"));
      } else {
        await createWithdraw.mutateAsync({
          type: "fiat",
          amount,
          paymentMethod: withdrawMethod,
          payoutInfo,
          note: withdrawNote.trim() || undefined,
        });
        toast.success(t("user.wallet.fiat-withdraw-success"));
      }
      setAmount("");
      setWithdrawMethod("");
      setPayoutInfo("");
      setWithdrawNote("");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(
              mode === "deposit"
                ? "user.wallet.fiat-deposit-failed"
                : "user.wallet.fiat-withdraw-failed",
            ),
      );
    }
  }, [
    activeConfig,
    amount,
    createTopup,
    createWithdraw,
    mode,
    onOpenChange,
    payoutInfo,
    t,
    withdrawMethod,
    withdrawNote,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {t(
              mode === "deposit"
                ? "user.wallet.fiat-deposit-title"
                : "user.wallet.fiat-withdraw-title",
            )}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              mode === "deposit"
                ? "user.wallet.fiat-deposit-desc"
                : "user.wallet.fiat-withdraw-desc",
            )}
          </p>

          {mode === "deposit" && enabledConfigs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("user.wallet.fiat-methods-empty")}
            </div>
          ) : mode === "deposit" ? (
            <Tabs
              value={String(activeConfig?.id ?? "")}
              onValueChange={setActiveConfigId}
              className="w-full"
            >
              <div className="overflow-x-auto">
                <TabsList className="h-auto justify-start p-1">
                  {enabledConfigs.map((config) => (
                    <TabsTrigger
                      key={config.id}
                      value={String(config.id)}
                      className="shrink-0 flex-none"
                    >
                      {config.displayName}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="min-h-[360px] pt-4">
                {enabledConfigs.map((config) => {
                  const data = safeParseConfig(config.config);
                  return (
                    <TabsContent
                      key={config.id}
                      value={String(config.id)}
                      className="mt-0 h-[360px] space-y-5 overflow-y-auto pr-2"
                    >
                      <Card className="gap-0 bg-secondary/60 shadow-none ring-0">
                        <CardHeader>
                          <CardDescription>{t("fiat.form.method")}</CardDescription>
                          <CardTitle>{config.displayName}</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4">
                          <ConfigDetails config={data} t={t} />
                        </CardContent>
                      </Card>

                      <Card className="gap-0 bg-accent/40 shadow-none ring-0">
                        <CardHeader>
                          <CardDescription>
                            {t("user.wallet.deposit-result-amount")}
                          </CardDescription>
                          <CardTitle className="text-sm font-medium">
                            {data.currency
                              ? `${t("fiat.form.currency")}: ${data.currency}`
                              : t("user.wallet.deposit-result-amount")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4">
                          <div className="space-y-2">
                            <Label>{t("user.wallet.deposit-result-amount")}</Label>
                            <Input
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              placeholder={t("user.wallet.fiat-amount-ph")}
                              inputMode="decimal"
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {mode === "deposit" ? null : (
                        <p className="text-xs text-muted-foreground">
                          {t("user.wallet.fiat-withdraw-hint")}
                        </p>
                      )}
                    </TabsContent>
                  );
                })}
              </div>
            </Tabs>
          ) : (
            <div className="min-h-[360px] pt-4">
              <div className="h-[360px] space-y-5 overflow-y-auto pr-2">
                <div className="space-y-2">
                  <Label>{t("user.wallet.fiat-withdraw-method")}</Label>
                  <Input
                    value={withdrawMethod}
                    onChange={(e) => setWithdrawMethod(e.target.value)}
                    placeholder={t("user.wallet.fiat-withdraw-method-ph")}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("user.wallet.fiat-withdraw-info")}</Label>
                  <Input
                    value={payoutInfo}
                    onChange={(e) => setPayoutInfo(e.target.value)}
                    placeholder={t("user.wallet.fiat-withdraw-info-ph")}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("user.wallet.fiat-withdraw-note")}</Label>
                  <Textarea
                    value={withdrawNote}
                    onChange={(e) => setWithdrawNote(e.target.value)}
                    placeholder={t("user.wallet.fiat-withdraw-note-ph")}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>{t("user.wallet.fiat-amount")}</Label>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={handleMaxAmount}
                    >
                      {t("user.wallet.withdraw-max")}: ${removeTailingZero(maxBalance)}
                    </Button>
                  </div>
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={t("user.wallet.fiat-amount-ph")}
                    inputMode="decimal"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {t("user.wallet.balance")}: ${removeTailingZero(maxBalance)}
                </p>

                <p className="text-xs text-muted-foreground">
                  {t("user.wallet.fiat-withdraw-hint")}
                </p>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              (mode === "deposit" && !activeConfig) ||
              !amount ||
              (mode === "withdraw" && (!withdrawMethod || !payoutInfo)) ||
              createTopup.isPending ||
              createWithdraw.isPending ||
              (mode === "deposit" && enabledConfigs.length === 0)
            }
          >
            {(createTopup.isPending || createWithdraw.isPending) && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            {t(
              mode === "deposit"
                ? "user.wallet.fiat-deposit-submit"
                : "user.wallet.fiat-withdraw-submit",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FiatPendingTopupDialog({
  open,
  onOpenChange,
  orderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number | null;
}) {
  const { t } = useTranslation();
  const { data: order } = useWalletTopupOrder(orderId, open && orderId !== null);
  const { data: configs = [] } = useWalletFiatConfigs(open);
  const submitProof = useSubmitFiatTopupProof();
  const [paymentProof, setPaymentProof] = useState("");
  const orderFiatConfig = order?.fiatConfig ?? null;

  const activeConfig = useMemo(
    () => orderFiatConfig ?? configs.find((cfg) => cfg.id === order?.fiatConfigId) ?? null,
    [configs, order?.fiatConfigId, orderFiatConfig],
  );
  const parsedConfig = useMemo(
    () => (activeConfig ? safeParseConfig(activeConfig.config) : {}),
    [activeConfig],
  );

  useEffect(() => {
    if (!open) {
      setPaymentProof("");
      return;
    }
    setPaymentProof(order?.paymentProof ?? "");
  }, [open, order?.paymentProof]);

  const handleSubmit = useCallback(async () => {
    if (!orderId || !paymentProof.trim()) return;
    try {
      await submitProof.mutateAsync({ id: orderId, paymentProof: paymentProof.trim() });
      onOpenChange(false);
      setPaymentProof("");
      toast.success(t("user.wallet.fiat-proof-success"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.wallet.fiat-proof-failed"));
    }
  }, [onOpenChange, orderId, paymentProof, submitProof, t]);

  const handleProofUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      if (!SAFE_IMAGE_MIME_RE.test(dataUrl)) {
        toast.error(t("user.wallet.fiat-proof-unsupported-type"));
        return;
      }

      setPaymentProof(dataUrl);
    },
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.wallet.fiat-proof-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("user.wallet.fiat-proof-desc")}</p>

          <div className="min-h-[360px] pt-1">
            <div className="h-[360px] space-y-5 overflow-y-auto pr-2">
              <div className="space-y-2">
                <Label>{t("topup.detail.method")}</Label>
                <p className="text-sm font-medium">
                  {activeConfig?.displayName ||
                    (order?.paymentMethod
                      ? t(`fiat.method.${order.paymentMethod}`, {
                          defaultValue: order.paymentMethod,
                        })
                      : "—")}
                </p>
              </div>

              <ConfigDetails config={parsedConfig} t={t} />

              <div className="space-y-2">
                <Label>{t("user.wallet.fiat-proof-label")}</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    void handleProofUpload(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("user.wallet.fiat-proof-upload-hint")}
                </p>
                {paymentProof ? (
                  <div className="space-y-3">
                    <div className="flex justify-center rounded-xl border border-border/70 bg-muted/20 p-4">
                      <img
                        src={paymentProof}
                        alt={t("user.wallet.fiat-proof-preview-alt")}
                        className="max-h-64 rounded-lg object-contain"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPaymentProof("")}
                    >
                      {t("fiat.btn.delete")}
                    </Button>
                  </div>
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">{t("user.wallet.fiat-proof-hint")}</p>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!orderId || !paymentProof.trim() || submitProof.isPending}
          >
            {submitProof.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t("user.wallet.fiat-proof-submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
