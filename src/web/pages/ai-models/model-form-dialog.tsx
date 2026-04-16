import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiKeys,
  useAiProviders,
  useBatchCreateAiModels,
  useCreateAiModel,
  useDiscoverModels,
  useUpdateAiModel,
} from "@/web/api/hooks";
import type { AiModel } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
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

// ── Form schema ──────────────────────────────────────────────────────

const modelFormSchema = z.object({
  modelId: z.string().min(1, "common.valid.required"),
  name: z.string().min(1, "common.valid.name-required"),
  contextWindow: z.number().int().positive().nullable().optional(),
  inputPrice: z.string().min(1, "common.valid.required"),
  outputPrice: z.string().min(1, "common.valid.required"),
  capabilities: z.string(),
  enabled: z.boolean(),
});
type ModelFormValues = z.infer<typeof modelFormSchema>;

// ── Dialog ───────────────────────────────────────────────────────────

export function ModelFormDialog({
  open,
  onOpenChange,
  providerId: initialProviderId,
  model,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providerId?: number | null;
  model?: AiModel | null;
}) {
  const { t } = useTranslation();
  const createModel = useCreateAiModel();
  const batchCreate = useBatchCreateAiModels();
  const updateModel = useUpdateAiModel();
  const { data: keys = [] } = useAiKeys();
  const { data: providers = [] } = useAiProviders();
  const isEdit = !!model;

  // Provider selection — use prop if provided, otherwise user picks
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(
    initialProviderId ?? null,
  );
  const providerId = initialProviderId ?? selectedProviderId;

  // Providers with at least one enabled key
  const providerIdsWithKeys = useMemo(
    () => new Set(keys.filter((k) => k.enabled).map((k) => k.providerId)),
    [keys],
  );
  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && providerIdsWithKeys.has(p.id)),
    [providers, providerIdsWithKeys],
  );

  // Discovery
  const [discoverEnabled, setDiscoverEnabled] = useState(true);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [batchCreating, setBatchCreating] = useState(false);
  const {
    data: discovered,
    error: discoverError,
    isFetching: discovering,
    refetch: fetchModels,
  } = useDiscoverModels(providerId ?? 0);

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: {
      modelId: "",
      name: "",
      contextWindow: null,
      inputPrice: "0",
      outputPrice: "0",
      capabilities: "",
      enabled: true,
    },
  });

  const availableModels = discovered?.filter((m) => !m.registered) ?? [];

  // Track previous discovered ref to auto-select only on fresh discovery
  const prevDiscoveredRef = useRef(discovered);

  useEffect(() => {
    if (discovered && discovered !== prevDiscoveredRef.current) {
      prevDiscoveredRef.current = discovered;
    }
  }, [discovered]);

  useEffect(() => {
    if (open && model) {
      form.reset({
        modelId: model.modelId,
        name: model.name,
        contextWindow: model.contextWindow ?? null,
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        capabilities: model.capabilities.join(", "),
        enabled: model.enabled,
      });
    } else if (open) {
      form.reset({
        modelId: "",
        name: "",
        contextWindow: null,
        inputPrice: "0",
        outputPrice: "0",
        capabilities: "",
        enabled: true,
      });
      setSelectedModels(new Set());
      prevDiscoveredRef.current = undefined;
      if (!initialProviderId) setSelectedProviderId(null);
    }
  }, [open, model, form, initialProviderId]);

  // Trigger discover when provider changes (and discover is enabled)
  useEffect(() => {
    if (open && !isEdit && discoverEnabled && providerId && providerId > 0) {
      prevDiscoveredRef.current = undefined;
      fetchModels();
    }
  }, [open, isEdit, discoverEnabled, providerId, fetchModels]);

  const handleToggleDiscover = useCallback(
    (checked: boolean) => {
      setDiscoverEnabled(checked);
      if (checked && providerId && providerId > 0) fetchModels();
    },
    [fetchModels, providerId],
  );

  const handleProviderChange = useCallback((value: string) => {
    const pid = Number(value);
    setSelectedProviderId(pid);
    setSelectedModels(new Set());
    prevDiscoveredRef.current = undefined;
  }, []);

  const handleToggleModel = useCallback((modelId: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedModels(new Set(availableModels.map((m) => m.modelId)));
  }, [availableModels]);

  const handleSelectNone = useCallback(() => {
    setSelectedModels(new Set());
  }, []);

  const hasKey = providerId ? keys.some((k) => k.providerId === providerId && k.enabled) : false;
  const noKey =
    discoverError instanceof Error || (!discovering && !discovered && discoverEnabled && !hasKey);
  const isBatchMode = !isEdit && discoverEnabled && availableModels.length > 0;
  const needsProvider = !isEdit && !providerId;

  // Batch create — single API call
  const handleBatchCreate = useCallback(async () => {
    if (!providerId) return;
    const fallbackCaps = form
      .getValues("capabilities")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const fallbackInput = form.getValues("inputPrice");
    const fallbackOutput = form.getValues("outputPrice");

    const models = [...selectedModels]
      .map((modelId) => availableModels.find((m) => m.modelId === modelId))
      .filter(Boolean)
      .map((m) => ({
        modelId: m!.modelId,
        name: m!.name,
        inputPrice: m!.inputPrice ?? fallbackInput,
        outputPrice: m!.outputPrice ?? fallbackOutput,
        capabilities: m!.capabilities ?? fallbackCaps,
        enabled: true,
      }));

    if (models.length === 0) return;

    setBatchCreating(true);
    try {
      const result = await batchCreate.mutateAsync({ providerId, models });
      toast.success(t("ai-models.toast.batch-created", { count: result.linked ?? result.created }));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-models.toast.create-error"));
    } finally {
      setBatchCreating(false);
    }
  }, [selectedModels, availableModels, form, batchCreate, providerId, t, onOpenChange]);

  // Single create/edit
  const handleSubmit = form.handleSubmit(async (data) => {
    const { capabilities: capsRaw, ...rest } = data;
    const capabilities = capsRaw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    try {
      if (isEdit) {
        await updateModel.mutateAsync({
          id: model.id,
          ...rest,
          capabilities,
        });
        toast.success(t("ai-models.toast.updated"));
      } else {
        if (!providerId) return;
        await createModel.mutateAsync({ providerId, ...rest, capabilities });
        toast.success(t("ai-models.toast.created"));
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
          <form onSubmit={isBatchMode ? (e) => e.preventDefault() : handleSubmit}>
            <DialogBody className="space-y-4">
              {/* Provider selector (when no providerId prop) */}
              {!isEdit && !initialProviderId && (
                <div className="space-y-2">
                  <Label>{t("ai-models.form.provider")}</Label>
                  <Select
                    value={selectedProviderId ? String(selectedProviderId) : ""}
                    onValueChange={handleProviderChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("ai-models.form.provider-ph")} />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledProviders.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          <div className="flex items-center gap-2">
                            {p.iconUrl ? (
                              <img
                                src={p.iconUrl}
                                alt=""
                                className="h-4 w-4 rounded-sm object-contain"
                                width={16}
                                height={16}
                              />
                            ) : (
                              <Sparkles className="h-4 w-4 text-muted-foreground" />
                            )}
                            {p.name}
                            <Badge variant="outline" className="text-xs ml-1">
                              {p.apiFormat}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Discover toggle — only show when provider is selected */}
              {!isEdit && providerId && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm font-medium">{t("ai-models.discover.toggle")}</span>
                  <Switch checked={discoverEnabled} onCheckedChange={handleToggleDiscover} />
                </div>
              )}

              {/* No key warning */}
              {!isEdit && providerId && discoverEnabled && noKey && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">{t("ai-models.discover.no-key")}</p>
                </div>
              )}

              {/* Loading */}
              {!isEdit && providerId && discoverEnabled && discovering && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {t("ai-models.discover.loading")}
                  </span>
                </div>
              )}

              {/* Batch mode: checkbox list */}
              {isBatchMode && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t("ai-models.discover.models")} ({selectedModels.size}/
                      {availableModels.length})
                    </span>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={handleSelectAll}>
                        {t("ai-models.discover.select-all")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={handleSelectNone}>
                        {t("ai-models.discover.select-none")}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-lg border p-2">
                    {availableModels.map((m) => (
                      <label
                        key={m.modelId}
                        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedModels.has(m.modelId)}
                          onCheckedChange={() => handleToggleModel(m.modelId)}
                        />
                        <span className="font-mono text-xs truncate">{m.modelId}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Single mode fields */}
              {!isBatchMode && !needsProvider && (
                <>
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
                </>
              )}

              {/* Shared: pricing + capabilities (hide when no provider selected yet) */}
              {!needsProvider && (
                <>
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

                  {!isBatchMode && (
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
                  )}
                </>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.btn.cancel")}
              </Button>
              {isBatchMode ? (
                <Button
                  type="button"
                  onClick={handleBatchCreate}
                  disabled={selectedModels.size === 0 || batchCreating}
                >
                  {batchCreating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {t("ai-models.btn.add-selected", { count: selectedModels.size })}
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={needsProvider || createModel.isPending || updateModel.isPending}
                >
                  {isEdit ? t("common.btn.save") : t("ai-models.btn.create")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
