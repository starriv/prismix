import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { useAiProviderAssignments, useCreateAiKey } from "@/web/api/hooks";
import type { AiProvider, KeyProvider } from "@/web/api/schemas";
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
import { SecretInput } from "@/web/components/ui/secret-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

const addKeyFormSchema = z.object({
  providerId: z.number().int().positive(),
  upstreamId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, "common.valid.name-required"),
  apiKey: z.string().min(1, "common.valid.required"),
  ownerId: z.number().int().positive().nullable().optional(),
});

type AddKeyFormValues = z.infer<typeof addKeyFormSchema>;

export function AddKeyDialog({
  open,
  onOpenChange,
  providers,
  keyProviders,
  defaultProviderId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providers: AiProvider[];
  keyProviders: KeyProvider[];
  defaultProviderId: number;
}) {
  const { t } = useTranslation();
  const createKey = useCreateAiKey();

  const activeKeyProviders = useMemo(
    () => keyProviders.filter((kp) => kp.status === "active"),
    [keyProviders],
  );

  const form = useForm<AddKeyFormValues>({
    resolver: zodResolver(addKeyFormSchema),
    defaultValues: {
      providerId: 0,
      upstreamId: null,
      name: "",
      apiKey: "",
      ownerId: null,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        providerId: defaultProviderId,
        upstreamId: null,
        name: "",
        apiKey: "",
        ownerId: null,
      });
    }
  }, [open, defaultProviderId, form]);

  const watchedProviderId = form.watch("providerId");
  const selectedProvider = providers.find((p) => p.id === watchedProviderId);
  const isSigV4 = selectedProvider?.authType === "sigv4";
  const { data: assignments = [] } = useAiProviderAssignments(watchedProviderId);
  const availableAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.enabled && assignment.upstream.enabled),
    [assignments],
  );

  useEffect(() => {
    form.setValue("upstreamId", null);
  }, [form, watchedProviderId]);

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await createKey.mutateAsync(data);
      toast.success(t("ai.toast.created"));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai.dialog.add-title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="providerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai.form.provider")}</FormLabel>
                    <Select
                      value={field.value > 0 ? String(field.value) : ""}
                      onValueChange={(v) => field.onChange(Number(v))}
                      disabled={defaultProviderId > 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("ai.form.provider-ph")} />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}
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
                name="upstreamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai.form.upstream")}</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : "legacy"}
                      onValueChange={(v) => field.onChange(v === "legacy" ? null : Number(v))}
                      disabled={watchedProviderId <= 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("ai.form.upstream-ph")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="legacy">{t("ai.form.upstream-legacy")}</SelectItem>
                        {availableAssignments.map((assignment) => (
                          <SelectItem
                            key={assignment.upstream.id}
                            value={String(assignment.upstream.id)}
                          >
                            {assignment.upstream.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {t("ai.form.upstream-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai.form.name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isSigV4 ? t("ai.form.secret-access-key") : t("ai.form.api-key")}
                    </FormLabel>
                    <FormControl>
                      <SecretInput
                        placeholder={
                          isSigV4 ? t("ai.form.secret-access-key-ph") : t("ai.form.api-key-ph")
                        }
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      {isSigV4 ? t("ai.form.secret-access-key-hint") : t("ai.form.api-key-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {activeKeyProviders.length > 0 && (
                <FormField
                  control={form.control}
                  name="ownerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai.form.owner")}</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : "none"}
                        onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("ai.form.owner-ph")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("ai.form.owner-none")}</SelectItem>
                          {activeKeyProviders.map((kp) => (
                            <SelectItem key={kp.id} value={String(kp.id)}>
                              {kp.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">{t("ai.form.owner-hint")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={createKey.isPending}>
                {t("ai.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
