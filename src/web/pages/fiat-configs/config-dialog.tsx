import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useCreateFiatConfig, useUpdateFiatConfig } from "@/web/api/hooks";
import type { FiatConfig } from "@/web/api/schemas";
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
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";

import { fiatConfigFormSchema, METHODS, safeParseConfig } from "./constants";
import type { FiatConfigFormValues, FiatMethod } from "./constants";
import { MethodConfigFields } from "./method-config-fields";

interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
  config?: FiatConfig;
}

export function ConfigDialog({ open, onClose, config }: ConfigDialogProps) {
  const { t } = useTranslation();
  const createConfig = useCreateFiatConfig();
  const updateConfig = useUpdateFiatConfig();
  const isEdit = !!config;

  const parsedConfig = config ? safeParseConfig(config.config) : {};

  const form = useForm<FiatConfigFormValues>({
    resolver: zodResolver(fiatConfigFormSchema) as Resolver<FiatConfigFormValues>,
    defaultValues: {
      method: (config?.method as FiatMethod) ?? "bank_transfer",
      displayName: config?.displayName ?? "",
      config: parsedConfig,
      enabled: config?.enabled ?? true,
    },
  });

  useEffect(() => {
    if (open) {
      const parsed = config ? safeParseConfig(config.config) : {};
      form.reset({
        method: (config?.method as FiatMethod) ?? "bank_transfer",
        displayName: config?.displayName ?? "",
        config: parsed,
        enabled: config?.enabled ?? true,
      });
    }
  }, [open, config, form]);

  const selectedMethod = form.watch("method");

  useEffect(() => {
    if (!isEdit) {
      form.setValue("config", {});
    }
  }, [selectedMethod, isEdit, form]);

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      if (isEdit) {
        await updateConfig.mutateAsync({
          id: config.id,
          displayName: data.displayName,
          config: data.config,
          enabled: data.enabled,
        });
        toast.success(t("fiat.toast.updated"));
      } else {
        await createConfig.mutateAsync({
          method: data.method,
          displayName: data.displayName,
          config: data.config,
          enabled: data.enabled,
        });
        toast.success(t("fiat.toast.created"));
      }
      onClose();
    } catch (err) {
      const key = isEdit ? "fiat.toast.update-error" : "fiat.toast.create-error";
      toast.error(err instanceof Error ? err.message : t(key));
    }
  });

  const isPending = createConfig.isPending || updateConfig.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            <CreditCard className="inline h-5 w-5 mr-2" />
            {isEdit ? t("fiat.dialog-title-edit") : t("fiat.dialog-title-create")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fiat.form.method")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {t(`fiat.method.${m}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fiat.form.display-name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("fiat.form.display-name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <MethodConfigFields
                method={selectedMethod}
                config={form.watch("config")}
                onChange={(c) => form.setValue("config", c)}
                t={t}
              />

              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                    <Label>{t("fiat.form.enabled")}</Label>
                  </div>
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && (
                  <span className="animate-spin">
                    <Loader2 className="mr-2 h-4 w-4" />
                  </span>
                )}
                {isEdit ? t("fiat.btn.save") : t("fiat.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
