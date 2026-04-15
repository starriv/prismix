import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCw, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import {
  useAiDefaultMarkup,
  useDeletePayAgent,
  useSyncPayAgent,
  useUpdatePayAgent,
} from "@/web/api/hooks";
import type { PayAgent as PayAgentType } from "@/web/api/schemas";
import { InfoRow } from "@/web/components/dashboard/info-row";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { SheetBody, SheetFooter } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";
import { WalletAddress } from "@/web/components/ui/wallet-address";
import { cn } from "@/web/shared/utils";

import { PayAgentResourcesList } from "./agent-resources-list";
import { editFormSchema, type EditFormValues, TOKEN_SYMBOL } from "./helpers";
import { ManualDebitDialog, ManualTopupDialog } from "./manual-topup-dialog";
import { TopupForm } from "./topup-form";

export function PayAgentDetailSheet({
  agent,
  onClose,
}: {
  agent: PayAgentType;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const updatePayAgent = useUpdatePayAgent();
  const deletePayAgent = useDeletePayAgent();
  const syncAgentMutation = useSyncPayAgent();
  const { data: globalMarkup } = useAiDefaultMarkup();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [walletAction, setWalletAction] = useState<"enable" | "disable" | null>(null);

  const markupDefault =
    agent.defaultMarkupPercent !== null ? String(agent.defaultMarkupPercent) : "";

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      name: agent.name,
      description: agent.description ?? "",
      perPayLimit: agent.perPayLimit ?? "",
      dailyLimit: agent.dailyLimit ?? "",
      monthlyLimit: agent.monthlyLimit ?? "",
      defaultMarkupPercent: markupDefault,
    },
  });

  useEffect(() => {
    form.reset({
      name: agent.name,
      description: agent.description ?? "",
      perPayLimit: agent.perPayLimit ?? "",
      dailyLimit: agent.dailyLimit ?? "",
      monthlyLimit: agent.monthlyLimit ?? "",
      defaultMarkupPercent:
        agent.defaultMarkupPercent !== null ? String(agent.defaultMarkupPercent) : "",
    });
    setConfirmDelete(false);
    setWalletAction(null);
  }, [agent, form]);

  const handleSave = form.handleSubmit(async (data) => {
    try {
      await updatePayAgent.mutateAsync({
        id: agent.id,
        ...data,
        perPayLimit: data.perPayLimit || null,
        dailyLimit: data.dailyLimit || null,
        monthlyLimit: data.monthlyLimit || null,
        defaultMarkupPercent:
          data.defaultMarkupPercent !== "" ? Number(data.defaultMarkupPercent) : null,
      });
      toast.success(t("agents.toast.updated"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.toast.update-error"));
    }
  });

  const handleStatusToggle = async (checked: boolean) => {
    try {
      await updatePayAgent.mutateAsync({
        id: agent.id,
        status: checked ? "active" : "suspended",
      });
      toast.success(t("agents.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.toast.update-error"));
    }
  };

  const handleEnableWallet = useCallback(() => setWalletAction("enable"), []);

  const handleConfirmWalletAction = useCallback(async () => {
    if (!walletAction) return;
    try {
      const newType = walletAction === "enable" ? "standard" : "ledger";
      await updatePayAgent.mutateAsync({ id: agent.id, type: newType });
      toast.success(
        t(walletAction === "enable" ? "agents.wallet.enabled" : "agents.wallet.disabled"),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.toast.update-error"));
    } finally {
      setWalletAction(null);
    }
  }, [walletAction, agent.id, updatePayAgent, t]);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deletePayAgent.mutateAsync(agent.id);
      toast.success(t("agents.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.toast.delete-error"));
    }
  };

  return (
    <Form {...form}>
      <SheetBody className="space-y-5">
        {/* ── Card 1: Balance & Status ── */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <p className="text-xs text-muted-foreground">{t("agents.th.balance")}</p>
                  {agent.address && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      disabled={syncAgentMutation.isPending}
                      onClick={() => syncAgentMutation.mutate(agent.id)}
                      aria-label={t("common.a11y.refresh")}
                    >
                      <RefreshCw
                        className={cn("h-3 w-3", syncAgentMutation.isPending && "animate-spin")}
                      />
                    </Button>
                  )}
                </div>
                <p className="text-2xl font-bold">
                  {removeTailingZero(agent.balance)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">{TOKEN_SYMBOL}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {agent.status === "active"
                    ? t("agents.status.active")
                    : t("agents.status.suspended")}
                </span>
                <Switch checked={agent.status === "active"} onCheckedChange={handleStatusToggle} />
              </div>
            </div>
            {agent.address ? (
              <WalletAddress address={agent.address} className="pt-1" />
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <p className="text-xs text-muted-foreground flex-1">{t("agents.ledger-hint")}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-xs"
                  onClick={handleEnableWallet}
                  disabled={updatePayAgent.isPending}
                >
                  <Wallet className="h-3.5 w-3.5 mr-1" />
                  {t("agents.wallet.enable")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Card 2: Owner ── */}
        {agent.userId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("agents.detail.owner")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label={t("agents.detail.user-name")} value={agent.userName || "—"} />
              <InfoRow label={t("agents.detail.user-uuid")} value={agent.userUuid || "—"} mono />
            </CardContent>
          </Card>
        )}

        {/* ── Card 3: Basic Info ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("agents.form.name")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">{t("agents.form.description")}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ── Card 3: Spending Limits ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("agents.detail.limits")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("agents.detail.limits-hint")}</p>
            <FormField
              control={form.control}
              name="perPayLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">{t("agents.form.per-pay-limit")}</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl className="flex-1">
                      <Input
                        placeholder={t("agents.form.per-pay-limit-ph")}
                        {...field}
                        value={field.value ?? ""}
                        className="text-xs"
                      />
                    </FormControl>
                    <span className="text-xs text-muted-foreground shrink-0">{TOKEN_SYMBOL}</span>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dailyLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">{t("agents.form.daily-limit")}</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl className="flex-1">
                      <Input
                        placeholder={t("agents.form.daily-limit-ph")}
                        {...field}
                        value={field.value ?? ""}
                        className="text-xs"
                      />
                    </FormControl>
                    <span className="text-xs text-muted-foreground shrink-0">{TOKEN_SYMBOL}</span>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="monthlyLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">{t("agents.form.monthly-limit")}</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl className="flex-1">
                      <Input
                        placeholder={t("agents.form.monthly-limit-ph")}
                        {...field}
                        value={field.value ?? ""}
                        className="text-xs"
                      />
                    </FormControl>
                    <span className="text-xs text-muted-foreground shrink-0">{TOKEN_SYMBOL}</span>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="defaultMarkupPercent"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormLabel className="text-xs">{t("agents.form.default-markup")}</FormLabel>
                    {agent.defaultMarkupPercent === null && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t("agents.form.global-badge")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <FormControl className="flex-1">
                      <Input
                        placeholder={`${globalMarkup?.defaultMarkupPercent ?? 0} (${t("agents.form.default-markup-ph")})`}
                        {...field}
                        value={field.value ?? ""}
                        className="text-xs"
                        type="number"
                        min={0}
                        max={1000}
                      />
                    </FormControl>
                    <span className="text-xs text-muted-foreground shrink-0">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("agents.form.default-markup-hint")}
                  </p>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ── Card 4: Top-up ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("agents.topup.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {agent.address && <TopupForm agent={agent} />}
            <ManualTopupDialog agentId={agent.id} />
            <ManualDebitDialog agentId={agent.id} balance={agent.balance} />
          </CardContent>
        </Card>

        {/* ── Allowed Resources (standard agents only — ledger agents don't use 402 gateway) ── */}
        {agent.type !== "ledger" && <PayAgentResourcesList agentId={agent.id} />}
      </SheetBody>

      <SheetFooter>
        {confirmDelete && (
          <p className="text-sm text-destructive mb-2">{t("agents.delete-confirm")}</p>
        )}
        <div className="flex gap-2 w-full">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deletePayAgent.isPending}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {confirmDelete ? t("common.btn.confirm") : t("agents.btn.delete")}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updatePayAgent.isPending}>
            {t("agents.btn.save")}
          </Button>
        </div>
      </SheetFooter>

      {/* Wallet enable/disable confirmation */}
      <Dialog open={!!walletAction} onOpenChange={() => setWalletAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(walletAction === "enable" ? "agents.wallet.enable" : "agents.wallet.disable")}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t(
                walletAction === "enable"
                  ? "agents.wallet.enable-confirm"
                  : "agents.wallet.disable-confirm",
              )}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletAction(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button onClick={handleConfirmWalletAction} disabled={updatePayAgent.isPending}>
              {t("common.btn.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
}
