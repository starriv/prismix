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
import type { AiModel, AiModelRoute, AiProvider } from "@/web/api/schemas";
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
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";

type ClientFormat = "openai" | "anthropic";

function canProviderServeClientFormat(clientFormat: ClientFormat, apiFormat: string): boolean {
  if (clientFormat === "openai") return true;
  return ["anthropic", "openai", "azure-openai"].includes(apiFormat);
}

export function ModelRoutesSheet({
  open,
  onOpenChange,
  model,
  providers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  model: AiModel;
  providers: AiProvider[];
}) {
  const { t } = useTranslation();
  const { data: routes = [], isLoading } = useAiModelRoutes(model.id);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AiModelRoute | null>(null);
  const deleteRoute = useDeleteAiModelRoute();

  const availableProviders = useMemo(() => {
    const routedIds = new Set(routes.map((r) => r.providerId));
    return providers.filter(
      (p) =>
        p.enabled &&
        !routedIds.has(p.id) &&
        canProviderServeClientFormat(model.clientFormat, p.apiFormat),
    );
  }, [model.clientFormat, providers, routes]);

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
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[520px]">
          <SheetHeader>
            <SheetTitle>
              {t("ai-models.routes.title")} — {model.modelId}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">{t("ai-models.routes.desc")}</p>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {t("ai-models.routes.btn.routes")}
                      <Badge variant="secondary" className="text-xs">
                        {routes.length}
                      </Badge>
                    </CardTitle>
                    <Button
                      size="sm"
                      onClick={() => setAddOpen(true)}
                      disabled={availableProviders.length === 0}
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
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <AddRouteDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        modelId={model.id}
        modelSlug={model.modelId}
        providers={availableProviders}
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
                provider: deleteTarget?.providerName ?? "",
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
      if (val === (route.providerModelId ?? "")) unchanged = true;
      else payload.providerModelId = val;
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

  const upstreamDisplay = route.providerModelId ?? modelSlug;
  const isDefault = !route.providerModelId;

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-2">
      {/* Row 1: Provider header */}
      <div className="flex items-center gap-2">
        {route.providerIconUrl ? (
          <img
            src={route.providerIconUrl}
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
          {route.providerName ?? `Provider #${route.providerId}`}
        </span>
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
        label={t("ai-models.routes.th.provider-model-id")}
        value={route.providerModelId ?? ""}
        displayValue={
          isDefault
            ? t("ai-models.routes.inline.default-model", { modelId: modelSlug })
            : upstreamDisplay
        }
        editing={editingField === "modelId"}
        onStartEdit={() => startEdit("modelId", route.providerModelId ?? "")}
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
  providers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  modelId: number;
  modelSlug: string;
  providers: AiProvider[];
}) {
  const { t } = useTranslation();
  const createRoute = useCreateAiModelRoute();
  const [providerId, setProviderId] = useState<string>("");
  const [providerModelId, setProviderModelId] = useState("");
  const [priority, setPriority] = useState("100");

  const handleSubmit = useCallback(async () => {
    const pid = Number(providerId);
    if (!pid) return;
    try {
      await createRoute.mutateAsync({
        modelId,
        providerId: pid,
        providerModelId: providerModelId || undefined,
        priority: Number(priority) || 100,
      });
      toast.success(t("ai-models.routes.toast.created"));
      onOpenChange(false);
      setProviderId("");
      setProviderModelId("");
      setPriority("100");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-models.toast.create-error"));
    }
  }, [providerId, providerModelId, priority, modelId, createRoute, t, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ai-models.routes.dialog.add-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label>{t("ai-models.routes.th.provider")}</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("ai-models.routes.form.provider-ph")} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
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

          <div className="space-y-2">
            <Label>{t("ai-models.routes.th.provider-model-id")}</Label>
            <Input
              placeholder={modelSlug}
              value={providerModelId}
              onChange={(e) => setProviderModelId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("ai-models.routes.form.provider-model-id-hint")}
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!providerId || createRoute.isPending}>
            {t("ai-models.routes.btn.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
