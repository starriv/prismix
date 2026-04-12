import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { useCreditUser } from "@/web/api/admin-hooks";
import type { UserInfo } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
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

const creditSchema = z.object({
  amount: z
    .string()
    .min(1, "common.valid.amount-required")
    .regex(/^\d+(\.\d+)?$/),
  description: z.string().max(500).optional(),
});

export function CreditDialog({ user, onClose }: { user: UserInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const creditUser = useCreditUser();

  const form = useForm<z.infer<typeof creditSchema>>({
    resolver: zodResolver(creditSchema),
    defaultValues: { amount: "", description: "" },
  });

  const handleSubmit = useCallback(
    async (data: z.infer<typeof creditSchema>) => {
      try {
        await creditUser.mutateAsync({
          id: user.id,
          amount: data.amount,
          description: data.description || undefined,
        });
        toast.success(t("admin.users.toast.credited"));
        onClose();
      } catch {
        toast.error(t("admin.users.toast.credit-error"));
      }
    },
    [creditUser, user.id, t, onClose],
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("admin.users.credit-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.users.form.amount")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("admin.users.form.amount-ph")}
                        inputMode="decimal"
                      />
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
                    <FormLabel>{t("admin.users.form.description")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("admin.users.form.description-ph")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={form.handleSubmit(handleSubmit)} disabled={creditUser.isPending}>
            {t("common.btn.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
