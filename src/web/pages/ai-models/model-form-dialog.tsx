import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { uniq } from "lodash-es";
import { toast } from "sonner";
import { z } from "zod";

import { useAdminUsers } from "@/web/api/admin-hooks";
import { useCreateAiModel, useUpdateAiModel } from "@/web/api/hooks";
import type { AiModel } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import { DateTimePicker } from "@/web/components/ui/date-picker";
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
import { MultiSelect, type MultiSelectOption } from "@/web/components/ui/multi-select";
import { Switch } from "@/web/components/ui/switch";

const modelFormSchema = z.object({
  modelId: z.string().min(1, "common.valid.required"),
  name: z.string().min(1, "common.valid.name-required"),
  contextWindow: z.number().int().positive().nullable().optional(),
  inputPrice: z.string().min(1, "common.valid.required"),
  outputPrice: z.string().min(1, "common.valid.required"),
  capabilities: z.string(),
  limitedFreeUntil: z.string(),
  grayReleaseEnabled: z.boolean(),
  grayUserIds: z.array(z.string()),
  enabled: z.boolean(),
});
type ModelFormValues = z.infer<typeof modelFormSchema>;

const EMPTY_MODEL_FORM: ModelFormValues = {
  modelId: "",
  name: "",
  contextWindow: null,
  inputPrice: "0",
  outputPrice: "0",
  capabilities: "",
  limitedFreeUntil: "",
  grayReleaseEnabled: false,
  grayUserIds: [],
  enabled: true,
};

function toDatetimeLocalValue(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toLimitedFreeIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isZeroPriceValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed === 0;
}

type GrayUserOptionSource = {
  id: number;
  name: string;
  email?: string | null;
  uuid?: string | null;
};

function toGrayUserOption(user: GrayUserOptionSource): MultiSelectOption {
  return {
    value: String(user.id),
    label: `#${user.id} ${user.name}${
      user.email ? ` · ${user.email}` : user.uuid ? ` · ${user.uuid}` : ""
    }`,
  };
}

function modelToFormValues(model: AiModel): ModelFormValues {
  return {
    modelId: model.modelId,
    name: model.name,
    contextWindow: model.contextWindow ?? null,
    inputPrice: model.inputPrice,
    outputPrice: model.outputPrice,
    capabilities: model.capabilities.join(", "),
    limitedFreeUntil: toDatetimeLocalValue(model.limitedFreeUntil),
    grayReleaseEnabled: model.grayReleaseEnabled,
    grayUserIds: (model.grayUserIds ?? model.grayUsers.map((user) => user.id)).map(String),
    enabled: model.enabled,
  };
}

export function ModelFormDialog({
  open,
  onOpenChange,
  model,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  model?: AiModel | null;
  onCreated?: (model: AiModel) => void;
}) {
  const { t } = useTranslation();
  const createModel = useCreateAiModel();
  const updateModel = useUpdateAiModel();
  const isEdit = !!model;
  const [grayUserSearch, setGrayUserSearch] = useState("");

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: EMPTY_MODEL_FORM,
  });
  const inputPrice = useWatch({ control: form.control, name: "inputPrice" });
  const outputPrice = useWatch({ control: form.control, name: "outputPrice" });
  const grayReleaseEnabled = useWatch({ control: form.control, name: "grayReleaseEnabled" });
  const limitedFreeEnabled = isZeroPriceValue(inputPrice) && isZeroPriceValue(outputPrice);

  const grayUserQuery = grayUserSearch.trim();
  const { data: grayUsersData, isFetching: grayUsersLoading } = useAdminUsers({
    page: 0,
    name: grayUserQuery && !grayUserQuery.includes("@") ? grayUserQuery : undefined,
    email: grayUserQuery.includes("@") ? grayUserQuery : undefined,
  });

  const grayUserOptions = useMemo(() => {
    const byId = new Map<string, MultiSelectOption>();
    for (const user of model?.grayUsers ?? []) {
      const option = toGrayUserOption(user);
      byId.set(option.value, option);
    }
    for (const user of grayUsersData?.items ?? []) {
      const option = toGrayUserOption(user);
      byId.set(option.value, option);
    }

    return [...byId.values()];
  }, [grayUsersData?.items, model?.grayUsers]);

  useEffect(() => {
    if (!open) return;

    if (model) {
      form.reset(modelToFormValues(model));
    } else {
      form.reset(EMPTY_MODEL_FORM);
    }
  }, [form, model, open]);

  useEffect(() => {
    if (!limitedFreeEnabled && form.getValues("limitedFreeUntil")) {
      form.setValue("limitedFreeUntil", "");
    }
  }, [limitedFreeEnabled, form]);

  const handleSubmit = form.handleSubmit(async (data) => {
    const {
      capabilities: capsRaw,
      grayUserIds: grayUserIdsRaw,
      limitedFreeUntil: limitedFreeRaw,
      ...rest
    } = data;
    const capabilities = capsRaw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const grayUserIds = uniq(grayUserIdsRaw.map(Number).filter(Number.isInteger));
    const limitedFreeUntil = toLimitedFreeIso(limitedFreeRaw);

    try {
      if (isEdit) {
        await updateModel.mutateAsync({
          id: model.id,
          ...rest,
          capabilities,
          grayUserIds,
          limitedFreeUntil,
        });
        toast.success(t("ai-models.toast.updated"));
      } else {
        const created = await createModel.mutateAsync({
          ...rest,
          capabilities,
          grayUserIds,
          limitedFreeUntil,
        });
        toast.success(t("ai-models.toast.created"));
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-models.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("ai-models.dialog.edit-title") : t("ai-models.dialog.add-title")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="modelId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-models.form.model-id")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("ai-models.form.model-id-ph")}
                        {...field}
                        disabled={isEdit}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-models.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-models.form.name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="inputPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-models.form.input-price")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("ai-models.form.price-ph")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="outputPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-models.form.output-price")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("ai-models.form.price-ph")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="limitedFreeUntil"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-models.form.limited-free-until")}</FormLabel>
                    <FormControl>
                      <DateTimePicker
                        disabled={!limitedFreeEnabled}
                        placeholder={t("ai-models.form.limited-free-ph")}
                        min={new Date()}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {limitedFreeEnabled
                        ? t("ai-models.form.limited-free-hint")
                        : t("ai-models.form.limited-free-disabled-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="capabilities"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-models.form.capabilities")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-models.form.capabilities-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel>{t("ai-models.form.enabled")}</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="grayReleaseEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel>{t("ai-models.form.gray-release")}</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {grayReleaseEnabled && (
                <FormField
                  control={form.control}
                  name="grayUserIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-models.form.gray-users")}</FormLabel>
                      <FormControl>
                        <MultiSelect
                          options={grayUserOptions}
                          value={field.value}
                          onValueChange={field.onChange}
                          placeholder={t("ai-models.form.gray-users-search-ph")}
                          searchValue={grayUserSearch}
                          onSearchChange={setGrayUserSearch}
                          searchPlaceholder={t("ai-models.form.gray-users-search-ph")}
                          loading={grayUsersLoading}
                          maxDisplay={4}
                        />
                      </FormControl>
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
              <Button type="submit" disabled={createModel.isPending || updateModel.isPending}>
                {isEdit ? t("common.btn.save") : t("ai-models.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
