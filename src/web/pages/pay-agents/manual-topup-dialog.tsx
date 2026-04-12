import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { HandCoins, Minus } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { useDebitPayAgent, useManualTopupPayAgent } from "@/web/api/hooks";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/web/components/ui/textarea";

import { manualTopupFormSchema, type ManualTopupFormValues } from "./helpers";

export function ManualTopupDialog({ agentId }: { agentId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const manualTopup = useManualTopupPayAgent();

  const form = useForm<ManualTopupFormValues>({
    resolver: zodResolver(manualTopupFormSchema),
    defaultValues: { amount: "", note: "" },
  });

  const handleSubmit = useCallback(
    async (data: ManualTopupFormValues) => {
      try {
        await manualTopup.mutateAsync({
          agentId,
          amount: data.amount,
          note: data.note || undefined,
        });
        toast.success(t("agents.toast.manual-topup"));
        form.reset();
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("agents.toast.manual-topup-error"));
      }
    },
    [agentId, manualTopup, form, t],
  );

  const onSubmit = form.handleSubmit(handleSubmit);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <HandCoins className="h-4 w-4 mr-1" />
          {t("agents.btn.manual-topup")}
        </Button>
      </DialogTrigger>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("agents.manual-topup.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground mb-4">{t("agents.manual-topup.desc")}</p>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agents.manual-topup.amount")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        placeholder={t("agents.manual-topup.amount-ph")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agents.manual-topup.note")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("agents.manual-topup.note-ph")}
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("common.btn.cancel")}
                </Button>
                <Button type="submit" disabled={manualTopup.isPending}>
                  {t("common.btn.confirm")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function ManualDebitDialog({ agentId, balance }: { agentId: number; balance: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const debit = useDebitPayAgent();
  const maxBalance = removeTailingZero(balance);

  const form = useForm<ManualTopupFormValues>({
    resolver: zodResolver(manualTopupFormSchema),
    defaultValues: { amount: "", note: "" },
  });

  const handleSubmit = useCallback(
    async (data: ManualTopupFormValues) => {
      try {
        await debit.mutateAsync({
          agentId,
          amount: data.amount,
          note: data.note || undefined,
        });
        toast.success(t("agents.toast.manual-debit"));
        form.reset();
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("agents.toast.manual-debit-error"));
      }
    },
    [agentId, debit, form, t],
  );

  const onSubmit = form.handleSubmit(handleSubmit);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Minus className="h-4 w-4 mr-1" />
          {t("agents.btn.manual-debit")}
        </Button>
      </DialogTrigger>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("agents.manual-debit.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground mb-4">{t("agents.manual-debit.desc")}</p>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>{t("agents.manual-debit.amount")}</FormLabel>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => form.setValue("amount", maxBalance)}
                      >
                        Max: {maxBalance} USDC
                      </Button>
                    </div>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        max={maxBalance}
                        placeholder={t("agents.manual-debit.amount-ph")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agents.manual-debit.note")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("agents.manual-debit.note-ph")}
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("common.btn.cancel")}
                </Button>
                <Button type="submit" variant="destructive" disabled={debit.isPending}>
                  {t("common.btn.confirm")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
