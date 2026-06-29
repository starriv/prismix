import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useBatchDeleteAiModels, useDeleteAiModel, useUpdateAiModel } from "@/web/api/hooks";
import type { AiEndpoint, AiModel } from "@/web/api/schemas";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { Input } from "@/web/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

import { ModelFormDialog } from "./model-form-dialog";
import { ModelImportDialog } from "./model-import-dialog";
import { SyncPricesDialog } from "./sync-prices-dialog";

function isZeroPriceValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed === 0;
}

function isZeroPriceModel(model: AiModel): boolean {
  return isZeroPriceValue(model.inputPrice) && isZeroPriceValue(model.outputPrice);
}

function isSuspiciousZeroPriceModel(model: AiModel): boolean {
  return isZeroPriceModel(model) && !model.isLimitedFree;
}

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "";
}

function supplierConnectionLabel(endpoint: Pick<AiEndpoint, "name" | "supplierName">): string {
  return endpoint.supplierName ? `${endpoint.supplierName} / ${endpoint.name}` : endpoint.name;
}

export function ModelList({
  models,
  endpoints,
  loading,
  onManageRoutes,
}: {
  models: AiModel[];
  endpoints: AiEndpoint[];
  loading: boolean;
  onManageRoutes: (model: AiModel) => void;
}) {
  const { t, i18n } = useTranslation();
  const updateModel = useUpdateAiModel();
  const deleteModel = useDeleteAiModel();
  const batchDelete = useBatchDeleteAiModels();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiModel | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [cleanZeroOpen, setCleanZeroOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [syncEndpointId, setSyncEndpointId] = useState(0);

  // Filters
  const [endpointFilter, setEndpointFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filteredModels = useMemo(() => {
    let result = models;

    if (endpointFilter === "no-routes") {
      result = result.filter((m) => !m.routes || m.routes.length === 0);
    } else if (endpointFilter !== "all") {
      const pid = Number(endpointFilter);
      result = result.filter((m) => m.routes?.some((r) => r.endpointId === pid));
    }

    if (statusFilter === "enabled") {
      result = result.filter((m) => m.enabled);
    } else if (statusFilter === "disabled") {
      result = result.filter((m) => !m.enabled);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (m) => m.modelId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
      );
    }

    return result;
  }, [models, endpointFilter, statusFilter, search]);

  const isFiltered = endpointFilter !== "all" || statusFilter !== "all" || search !== "";

  const handleResetFilters = useCallback(() => {
    setEndpointFilter("all");
    setStatusFilter("all");
    setSearch("");
  }, []);

  const zeroPriceModels = useMemo(() => models.filter(isSuspiciousZeroPriceModel), [models]);

  const allSelected = filteredModels.length > 0 && filteredModels.every((m) => selected.has(m.id));

  const handleToggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredModels.map((m) => m.id)));
    }
  }, [allSelected, filteredModels]);

  const handleToggle = useCallback(
    async (model: AiModel) => {
      try {
        await updateModel.mutateAsync({
          id: model.id,
          enabled: !model.enabled,
        });
        toast.success(t("ai-models.toast.updated"));
      } catch {
        toast.error(t("ai-models.toast.update-error"));
      }
    },
    [updateModel, t],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteModel.mutateAsync({ id: deleteTarget.id });
      toast.success(t("ai-models.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("ai-models.toast.delete-error"));
    }
  }, [deleteTarget, deleteModel, t]);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      const result = await batchDelete.mutateAsync({ ids });
      toast.success(t("ai-models.toast.batch-deleted", { count: result.deleted }));
      setSelected(new Set());
      setBatchDeleteOpen(false);
    } catch {
      toast.error(t("ai-models.toast.delete-error"));
    }
  }, [selected, batchDelete, t]);

  const handleCleanZeroPrice = useCallback(async () => {
    const ids = zeroPriceModels.map((m) => m.id);
    if (ids.length === 0) return;
    try {
      const result = await batchDelete.mutateAsync({ ids });
      toast.success(t("ai-models.toast.batch-deleted", { count: result.deleted }));
      setCleanZeroOpen(false);
    } catch {
      toast.error(t("ai-models.toast.delete-error"));
    }
  }, [zeroPriceModels, batchDelete, t]);

  const columns = useMemo<ColumnDef<AiModel>[]>(
    () => [
      {
        id: "select",
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={() => handleToggleSelect(row.original.id)}
            aria-label={t("common.a11y.select-row", { name: row.original.name })}
          />
        ),
        enableHiding: false,
        header: () => (
          <Checkbox
            checked={allSelected}
            onCheckedChange={handleToggleAll}
            aria-label={t("common.a11y.select-all")}
          />
        ),
        meta: { headerClassName: "w-10" },
      },
      {
        accessorKey: "modelId",
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <DataTableBadge variant="secondary" className="font-mono">
              {row.original.modelId}
            </DataTableBadge>
            {row.original.isLimitedFree && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                title={t("ai-models.tag.limited-free-until", {
                  time: formatDateTime(row.original.limitedFreeUntil, i18n.language),
                })}
              >
                {t("ai-models.tag.limited-free")}
              </Badge>
            )}
            {row.original.grayReleaseEnabled && (
              <Badge
                variant="outline"
                className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
              >
                {t("ai-models.tag.gray-release")}
              </Badge>
            )}
          </div>
        ),
        header: t("ai-models.th.model-id"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("ai-models.th.name"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "inputPrice",
        cell: ({ row }) => (
          <DataTableText
            mono
            numeric
            className={
              row.original.isLimitedFree
                ? "text-emerald-700 dark:text-emerald-300"
                : isSuspiciousZeroPriceModel(row.original)
                  ? "text-yellow-600"
                  : undefined
            }
          >
            ${row.original.inputPrice}
          </DataTableText>
        ),
        header: t("ai-models.th.input-price"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "outputPrice",
        cell: ({ row }) => (
          <DataTableText
            mono
            numeric
            className={
              row.original.isLimitedFree
                ? "text-emerald-700 dark:text-emerald-300"
                : isSuspiciousZeroPriceModel(row.original)
                  ? "text-yellow-600"
                  : undefined
            }
          >
            ${row.original.outputPrice}
          </DataTableText>
        ),
        header: t("ai-models.th.output-price"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            onCheckedChange={() => void handleToggle(row.original)}
            disabled={updateModel.isPending}
          />
        ),
        header: t("ai-models.th.enabled"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onManageRoutes(row.original)}
                  aria-label={t("ai-models.btn.routes")}
                >
                  <Route className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("ai-models.btn.routes")}</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setEditTarget(row.original)}
              aria-label={t("common.btn.edit")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t("common.btn.delete")}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
      },
    ],
    [
      allSelected,
      handleToggle,
      handleToggleAll,
      handleToggleSelect,
      i18n.language,
      onManageRoutes,
      selected,
      t,
      updateModel.isPending,
    ],
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t("ai-models.card-title")}
            </CardTitle>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <Button variant="destructive" size="sm" onClick={() => setBatchDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  {t("ai-models.btn.delete-selected", { count: selected.size })}
                </Button>
              )}
              {zeroPriceModels.length > 0 && selected.size === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCleanZeroOpen(true)}
                  className="text-yellow-600 border-yellow-600/30 hover:bg-yellow-50 dark:hover:bg-yellow-950/20"
                >
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  {t("ai-models.btn.clean-zero-price")}
                  <Badge variant="secondary" className="ml-1.5">
                    {zeroPriceModels.length}
                  </Badge>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <RefreshCw className="h-4 w-4 mr-1" />
                    {t("ai-models.btn.sync-prices")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {endpoints
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => {
                          setSyncEndpointId(p.id);
                          setSyncOpen(true);
                        }}
                      >
                        {p.iconUrl ? (
                          <img
                            src={p.iconUrl}
                            alt=""
                            className="mr-2 h-4 w-4 rounded-sm object-contain"
                            width={16}
                            height={16}
                          />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4 text-muted-foreground" />
                        )}
                        {supplierConnectionLabel(p)}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Download className="h-4 w-4 mr-1" />
                {t("ai-models.btn.import")}
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("ai-models.btn.new")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            <Select value={endpointFilter} onValueChange={setEndpointFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ai-models.filter.all-endpoints")}</SelectItem>
                <SelectItem value="no-routes">{t("ai-models.filter.no-routes")}</SelectItem>
                {endpoints
                  .filter((p) => p.enabled)
                  .map((p) => (
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
                        {supplierConnectionLabel(p)}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ai-models.filter.all-status")}</SelectItem>
                <SelectItem value="enabled">{t("ai-models.filter.enabled")}</SelectItem>
                <SelectItem value="disabled">{t("ai-models.filter.disabled")}</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative w-full sm:w-[240px]">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t("ai-models.filter.search-ph")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {isFiltered && (
              <>
                <Button size="sm" variant="outline" onClick={handleResetFilters}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  {t("common.btn.reset")}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {filteredModels.length} / {models.length}
                </span>
              </>
            )}
          </div>

          <DataTable
            columns={columns}
            data={filteredModels}
            emptyText={t("ai-models.empty")}
            getRowId={(row) => String(row.id)}
            loading={loading}
            rowClassName={(row) =>
              row.isLimitedFree
                ? "bg-emerald-50/40 dark:bg-emerald-950/10"
                : isSuspiciousZeroPriceModel(row)
                  ? "bg-yellow-50/50 dark:bg-yellow-950/10"
                  : undefined
            }
            showPagination
            tableClassName="min-w-[1080px]"
          />
        </CardContent>
      </Card>

      <ModelFormDialog open={addOpen} onOpenChange={setAddOpen} onCreated={onManageRoutes} />

      <ModelImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {syncEndpointId > 0 && (
        <SyncPricesDialog
          open={syncOpen}
          onOpenChange={(v) => {
            setSyncOpen(v);
            if (!v) setSyncEndpointId(0);
          }}
          endpointId={syncEndpointId}
        />
      )}

      {editTarget && (
        <ModelFormDialog
          open={!!editTarget}
          onOpenChange={(v) => {
            if (!v) setEditTarget(null);
          }}
          model={editTarget}
        />
      )}

      {/* Single delete dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-models.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-models.dialog.delete-body", { name: deleteTarget?.name })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteModel.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch delete dialog */}
      <Dialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-models.dialog.batch-delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-models.dialog.batch-delete-body", { count: selected.size })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteOpen(false)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={batchDelete.isPending}
            >
              {t("ai-models.btn.delete-selected", { count: selected.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clean zero-price dialog */}
      <Dialog open={cleanZeroOpen} onOpenChange={setCleanZeroOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-models.dialog.clean-zero-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-models.dialog.clean-zero-body", { count: zeroPriceModels.length })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanZeroOpen(false)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCleanZeroPrice}
              disabled={batchDelete.isPending}
            >
              {t("common.btn.delete")} ({zeroPriceModels.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
