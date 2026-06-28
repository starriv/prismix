import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  useAiEndpointCredentials,
  useAiEndpoints,
  useBatchCreateAiModels,
  useDiscoverModels,
} from "@/web/api/hooks";
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
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

type ClientFormat = "openai" | "anthropic";
type DiscoverSource = "official" | "upstream";

function defaultClientFormatForApiFormat(apiFormat?: string): ClientFormat {
  return apiFormat === "anthropic" ? "anthropic" : "openai";
}

function supplierConnectionLabel(endpoint: { name: string; supplierName?: string }): string {
  return endpoint.supplierName ? `${endpoint.supplierName} / ${endpoint.name}` : endpoint.name;
}

export function ModelImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: endpoints = [] } = useAiEndpoints();
  const [endpointId, setEndpointId] = useState<number | null>(null);
  const [clientFormat, setClientFormat] = useState<ClientFormat>("openai");
  const [source, setSource] = useState<DiscoverSource>("official");
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [batchCreating, setBatchCreating] = useState(false);
  const batchCreate = useBatchCreateAiModels();

  const enabledEndpoints = useMemo(() => endpoints.filter((p) => p.enabled), [endpoints]);
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === endpointId) ?? null,
    [endpointId, endpoints],
  );
  const hasUpstreams = (selectedEndpoint?.upstreamCount ?? 0) > 0;
  const { data: keys = [] } = useAiEndpointCredentials(endpointId ?? 0);
  const {
    data: discovered,
    error: discoverError,
    isFetching: discovering,
    refetch: fetchModels,
  } = useDiscoverModels(endpointId ?? 0, source, clientFormat);

  const availableModels = useMemo(
    () => discovered?.filter((model) => !model.registered) ?? [],
    [discovered],
  );
  const prevDiscoveredRef = useRef(discovered);

  useEffect(() => {
    if (!open) return;
    const first = enabledEndpoints[0];
    setEndpointId(first?.id ?? null);
    setClientFormat(defaultClientFormatForApiFormat(first?.apiFormat));
    setSource("official");
    setSelectedModels(new Set());
    prevDiscoveredRef.current = undefined;
  }, [enabledEndpoints, open]);

  useEffect(() => {
    if (!open || !endpointId) return;
    setSelectedModels(new Set());
    prevDiscoveredRef.current = undefined;
    void fetchModels();
  }, [clientFormat, endpointId, fetchModels, open, source]);

  useEffect(() => {
    if (discovered && discovered !== prevDiscoveredRef.current) {
      const selectable = discovered.filter((model) => !model.registered);
      setSelectedModels(new Set(selectable.map((model) => model.modelId)));
      prevDiscoveredRef.current = discovered;
    }
  }, [discovered]);

  const hasKey = endpointId
    ? keys.some(
        (key) =>
          key.endpointId === endpointId &&
          key.enabled &&
          (source === "official" ? key.upstreamId == null : key.upstreamId != null),
      )
    : false;
  const noKey = discoverError instanceof Error || (!discovering && !discovered && !hasKey);

  const handleEndpointChange = useCallback(
    (value: string) => {
      const nextEndpoint = endpoints.find((endpoint) => endpoint.id === Number(value));
      setEndpointId(nextEndpoint?.id ?? null);
      setClientFormat(defaultClientFormatForApiFormat(nextEndpoint?.apiFormat));
      setSource("official");
      setSelectedModels(new Set());
      prevDiscoveredRef.current = undefined;
    },
    [endpoints],
  );

  const handleToggleModel = useCallback((modelId: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedModels(new Set(availableModels.map((model) => model.modelId)));
  }, [availableModels]);

  const handleSelectNone = useCallback(() => {
    setSelectedModels(new Set());
  }, []);

  const handleImport = useCallback(async () => {
    if (!endpointId) return;
    const models = [...selectedModels]
      .map((modelId) => availableModels.find((model) => model.modelId === modelId))
      .filter(Boolean)
      .map((model) => ({
        clientFormat,
        modelId: model!.modelId,
        name: model!.name,
        contextWindow: model!.contextWindow ?? null,
        inputPrice: model!.inputPrice ?? "0",
        outputPrice: model!.outputPrice ?? "0",
        capabilities: model!.capabilities ?? [],
        enabled: true,
      }));

    if (models.length === 0) return;

    setBatchCreating(true);
    try {
      const result = await batchCreate.mutateAsync({ endpointId, models });
      toast.success(t("ai-models.toast.batch-created", { count: result.linked ?? result.created }));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-models.toast.create-error"));
    } finally {
      setBatchCreating(false);
    }
  }, [availableModels, batchCreate, clientFormat, endpointId, onOpenChange, selectedModels, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai-models.import.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label>{t("ai-models.import.connection")}</Label>
            <Select
              value={endpointId ? String(endpointId) : ""}
              onValueChange={handleEndpointChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("ai-models.import.connection-ph")} />
              </SelectTrigger>
              <SelectContent>
                {enabledEndpoints.map((endpoint) => (
                  <SelectItem key={endpoint.id} value={String(endpoint.id)}>
                    <div className="flex items-center gap-2">
                      {endpoint.iconUrl ? (
                        <img
                          src={endpoint.iconUrl}
                          alt=""
                          className="h-4 w-4 rounded-sm object-contain"
                          width={16}
                          height={16}
                        />
                      ) : (
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="min-w-0 truncate">{supplierConnectionLabel(endpoint)}</span>
                      <Badge variant="outline" className="ml-1 text-xs">
                        {endpoint.apiFormat}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("ai-models.form.client-format")}</Label>
              <Select
                value={clientFormat}
                onValueChange={(value) => setClientFormat(value as ClientFormat)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("ai-models.import.source")}</Label>
              <Select
                value={source}
                onValueChange={(value) => setSource(value as DiscoverSource)}
                disabled={!hasUpstreams}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="official">
                    {t("ai-models.discover.source-official")}
                  </SelectItem>
                  <SelectItem value="upstream">
                    {t("ai-models.discover.source-upstream")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {noKey && endpointId && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs text-muted-foreground">{t("ai-models.discover.no-key")}</p>
            </div>
          )}

          {discovering && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t("ai-models.discover.loading")}
              </span>
            </div>
          )}

          {availableModels.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t("ai-models.discover.models")} ({selectedModels.size}/{availableModels.length})
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
              <div className="max-h-[260px] space-y-1 overflow-y-auto rounded-lg border p-2">
                {availableModels.map((model) => (
                  <label
                    key={model.modelId}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                  >
                    <Checkbox
                      checked={selectedModels.has(model.modelId)}
                      onCheckedChange={() => handleToggleModel(model.modelId)}
                    />
                    <span className="truncate font-mono text-xs">{model.modelId}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={selectedModels.size === 0 || batchCreating}
          >
            {batchCreating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("ai-models.import.submit", { count: selectedModels.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
