import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { useCreateKeyProvider } from "@/web/api/hooks";
import { createKeyProviderBody } from "@/web/api/schemas";
import type { CreateKeyProviderBody } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { EmailInput } from "@/web/components/ui/email-input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";

export function CreateKeyProviderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const createMutation = useCreateKeyProvider();

  const form = useForm<CreateKeyProviderBody>({
    resolver: zodResolver(createKeyProviderBody),
    defaultValues: { name: "", email: "", revenueSharePercent: 70 },
  });

  const onSubmit = useCallback(
    async (data: CreateKeyProviderBody) => {
      try {
        await createMutation.mutateAsync(data);
        toast.success(t("admin.key-providers.toast.created"));
        form.reset();
        onOpenChange(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("admin.key-providers.toast.create-error"),
        );
      }
    },
    [createMutation, form, onOpenChange, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("admin.key-providers.btn.create")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogBody>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.th.name")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t("admin.key-providers.form.name-ph")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.key-providers.form.email")}</FormLabel>
                      <FormControl>
                        <EmailInput
                          {...field}
                          placeholder={t("admin.key-providers.form.email-ph")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="revenueSharePercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.key-providers.form.share")}</FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl className="flex-1">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            placeholder="70"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                field.onChange(undefined);
                                return;
                              }
                              const n = Number(raw);
                              if (!Number.isNaN(n) && n >= 0 && n <= 100) field.onChange(n);
                            }}
                          />
                        </FormControl>
                        <span className="text-sm text-muted-foreground shrink-0">%</span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {t("admin.key-providers.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
