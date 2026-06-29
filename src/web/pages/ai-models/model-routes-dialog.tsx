import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { sortBy } from "lodash-es";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useAiModelRoutes,
  useCreateAiModelRoute,
  useDeleteAiModelRoute,
  useUpdateAiModelRoute,
} from "@/web/api/hooks";
import type { AiEndpoint, AiModel, AiModelRoute } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
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

function supplierConnectionLabel(endpoint: Pick<AiEndpoint, "name" | "supplierName">): string {
  return endpoint.supplierName ? `${endpoint.supplierName} / ${endpoint.name}` : endpoint.name;
}

export function ModelRoutesDialog({
  open,
  onOpenChange,
  model,
  endpoints,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  model: AiModel;
  endpoints: AiEndpoint[];
}) {
  const { t } = useTranslation();
  const { data: routes = [], isLoading } = useAiModelRoutes(model.id);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AiModelRoute | null>(null);
  const deleteRoute = useDeleteAiModelRoute();

  const availableEndpoints = useMemo(() => {
    const routedIds = new Set(routes.map((r) => r.endpointId));
    return endpoints.filter((p) => p.enabled && !routedIds.has(p.id));
  }, [endpoints, routes]);

  const sortedRoutes = useMemo(() => sortBy(routes, "priority"), [routes]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteRoute.mutateAsync({ modelId: model.id, routeId: deleteTarget.id });
      toast.success(t("ai-models.routes.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("ai-models.toast.delete-error"));
    }
  }, [deleteTarget, deleteRoute, model.id, t]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[760px] lg:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>
              {t("ai-models.routes.title")} — {model.modelId}
            </DialogTitle>
            <DialogDescription>{t("ai-models.routes.desc")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    {t("ai-models.routes.btn.routes")}
                    <Badge variant="secondary" className="text-xs">
                      {routes.length}
                    </Badge>
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setAddOpen(true)}
                    disabled={availableEndpoints.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t("ai-models.routes.btn.add")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
                ) : sortedRoutes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    {t("ai-models.routes.empty")}
                  </p>
                ) : (
                  sortedRoutes.map((route) => (
                    <RouteCard
                      key={route.id}
                      route={route}
                      modelId={model.id}
                      modelSlug={model.modelId}
                      onDelete={setDeleteTarget}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <AddRouteDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        modelId={model.id}
        modelSlug={model.modelId}
        endpoints={availableEndpoints}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-models.routes.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-models.routes.dialog.delete-body", {
                provider: deleteTarget?.endpointName ?? "",
              })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteRoute.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Route Card ─────────────────────────────────────────────────────

type EditingField = "priority" | "weight" | "modelId" | null;

function RouteCard({
  route,
  modelId,
  modelSlug,
  onDelete,
}: {
  route: AiModelRoute;
  modelId: number;
  modelSlug: string;
  onDelete: (route: AiModelRoute) => void;
}) {
  const { t } = useTranslation();
  const updateRoute = useUpdateAiModelRoute();
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [draft, setDraft] = useState("");
  const savingRef = useRef(false);

  const startEdit = useCallback((field: EditingField, currentValue: string) => {
    setEditingField(field);
    setDraft(currentValue);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setDraft("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (savingRef.current || !editingField) return;

    const trimmed = draft.trim();
    let unchanged = false;

    const payload: Record<string, unknown> = { modelId, routeId: route.id };

    if (editingField === "priority") {
      const val = Number(trimmed) || 0;
      if (val === route.priority) unchanged = true;
      else payload.priority = val;
    } else if (editingField === "weight") {
      const val = Number(trimmed) || 0;
      if (val === route.weight) unchanged = true;
      else payload.weight = val;
    } else if (editingField === "modelId") {
      const val = trimmed || null;
      if (val === (route.endpointModelId ?? "")) unchanged = true;
      else payload.endpointModelId = val;
    }

    if (unchanged) {
      cancelEdit();
      return;
    }

    savingRef.current = true;
    try {
      await updateRoute.mutateAsync(payload as Parameters<typeof updateRoute.mutateAsync>[0]);
      toast.success(t("ai-models.routes.toast.updated"));
      cancelEdit();
    } catch {
      toast.error(t("ai-models.toast.update-error"));
    } finally {
      savingRef.current = false;
    }
  }, [editingField, draft, modelId, route, updateRoute, cancelEdit, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") void saveEdit();
    },
    [saveEdit],
  );

  const handleToggle = useCallback(async () => {
    try {
      await updateRoute.mutateAsync({
        modelId,
        routeId: route.id,
        enabled: !route.enabled,
      });
    } catch {
      toast.error(t("ai-models.toast.update-error"));
    }
  }, [updateRoute, modelId, route.id, route.enabled, t]);

  const upstreamDisplay = route.endpointModelId ?? modelSlug;
  const isDefault = !route.endpointModelId;

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-2">
      {/* Row 1: Endpoint header */}
      <div className="flex items-center gap-2">
        {route.endpointIconUrl ? (
          <img
            src={route.endpointIconUrl}
            alt=""
            className="h-8 w-8 rounded-md object-contain"
            width={32}
            height={32}
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
        )}
        <span className="text-sm font-medium truncate">
          {route.supplierName
            ? `${route.supplierName} / ${route.endpointName ?? `#${route.endpointId}`}`
            : (route.endpointName ?? `Connection #${route.endpointId}`)}
        </span>
        {route.endpointSlug && (
          <Badge variant="outline" className="text-xs shrink-0 font-mono">
            {route.endpointSlug}
          </Badge>
        )}
        {route.apiFormat && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {route.apiFormat}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Switch
            checked={route.enabled}
            onCheckedChange={() => void handleToggle()}
            disabled={updateRoute.isPending}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(route)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Row 2: Priority + Weight */}
      <div className="grid grid-cols-2 gap-3">
        <EditableField
          label={t("ai-models.routes.th.priority")}
          value={String(route.priority)}
          displayValue={`#${route.priority}`}
          editing={editingField === "priority"}
          onStartEdit={() => startEdit("priority", String(route.priority))}
          draft={draft}
          onDraftChange={setDraft}
          onKeyDown={handleKeyDown}
          onBlur={() => void saveEdit()}
          inputType="number"
          mono
        />
        <EditableField
          label={t("ai-models.routes.th.weight")}
          value={String(route.weight)}
          displayValue={String(route.weight)}
          editing={editingField === "weight"}
          onStartEdit={() => startEdit("weight", String(route.weight))}
          draft={draft}
          onDraftChange={setDraft}
          onKeyDown={handleKeyDown}
          onBlur={() => void saveEdit()}
          inputType="number"
          mono
        />
      </div>

      {/* Row 3: Upstream Model */}
      <EditableField
        label={t("ai-models.routes.th.endpoint-model-id")}
        value={route.endpointModelId ?? ""}
        displayValue={
          isDefault
            ? t("ai-models.routes.inline.default-model", { modelId: modelSlug })
            : upstreamDisplay
        }
        editing={editingField === "modelId"}
        onStartEdit={() => startEdit("modelId", route.endpointModelId ?? "")}
        draft={draft}
        onDraftChange={setDraft}
        onKeyDown={handleKeyDown}
        onBlur={() => void saveEdit()}
        placeholder={modelSlug}
        mono
        muted={isDefault}
      />
    </div>
  );
}

// ── Editable Field ─────────────────────────────────────────────────

function EditableField({
  label,
  displayValue,
  editing,
  onStartEdit,
  draft,
  onDraftChange,
  onKeyDown,
  onBlur,
  inputType = "text",
  placeholder,
  mono,
  muted,
}: {
  label: string;
  value: string;
  displayValue: string;
  editing: boolean;
  onStartEdit: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onBlur: () => void;
  inputType?: "text" | "number";
  placeholder?: string;
  mono?: boolean;
  muted?: boolean;
}) {
  const { t } = useTranslation();

  if (editing) {
    return (
      <div className="space-y-0.5">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <Input
          autoFocus
          type={inputType}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          className="h-7 text-xs"
        />
      </div>
    );
  }

  return (
    <div className="space-y-0.5 group/field">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <button
        type="button"
        className="flex items-center gap-1 w-full text-left"
        onClick={onStartEdit}
        title={t("ai-models.routes.inline.click-to-edit")}
      >
        <span
          className={`text-xs truncate ${mono ? "font-mono" : ""} ${muted ? "text-muted-foreground italic" : ""}`}
        >
          {displayValue}
        </span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/field:opacity-100 transition-opacity shrink-0" />
      </button>
    </div>
  );
}

// ── Add Route Dialog ───────────────────────────────────────────────

function AddRouteDialog({
  open,
  onOpenChange,
  modelId,
  modelSlug,
  endpoints,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  modelId: number;
  modelSlug: string;
  endpoints: AiEndpoint[];
}) {
  const { t } = useTranslation();
  const createRoute = useCreateAiModelRoute();
  const [endpointId, setEndpointId] = useState<string>("");
  const [endpointModelId, setEndpointModelId] = useState("");
  const [priority, setPriority] = useState("100");
  const [weight, setWeight] = useState("1");

  const handleSubmit = useCallback(async () => {
    const pid = Number(endpointId);
    if (!pid) return;
    try {
      await createRoute.mutateAsync({
        modelId,
        endpointId: pid,
        endpointModelId: endpointModelId.trim() || undefined,
        priority: Number(priority) || 100,
        weight: Number(weight) || 1,
      });
      toast.success(t("ai-models.routes.toast.created"));
      onOpenChange(false);
      setEndpointId("");
      setEndpointModelId("");
      setPriority("100");
      setWeight("1");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-models.toast.create-error"));
    }
  }, [endpointId, endpointModelId, priority, weight, modelId, createRoute, t, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ai-models.routes.dialog.add-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label>{t("ai-models.routes.th.endpoint")}</Label>
            <Select value={endpointId} onValueChange={setEndpointId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("ai-models.routes.form.endpoint-ph")} />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((p) => (
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
                      <span className="min-w-0 truncate">{supplierConnectionLabel(p)}</span>
                      <Badge variant="outline" className="text-xs ml-1">
                        {p.apiFormat}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("ai-models.routes.th.endpoint-model-id")}</Label>
            <Input
              placeholder={modelSlug}
              value={endpointModelId}
              onChange={(e) => setEndpointModelId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("ai-models.routes.form.endpoint-model-id-hint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("ai-models.routes.th.priority")}</Label>
            <Input
              type="number"
              min={0}
              max={10000}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("ai-models.routes.form.priority-hint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("ai-models.routes.th.weight")}</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!endpointId || createRoute.isPending}>
            {t("ai-models.routes.btn.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
