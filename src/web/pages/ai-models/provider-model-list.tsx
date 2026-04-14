import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ArrowLeft, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useAiModels,
  useBatchDeleteAiModels,
  useDeleteAiModel,
  useUpdateAiModel,
} from "@/web/api/hooks";
import type { AiModel, AiProvider } from "@/web/api/schemas";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader } from "@/web/components/ui/card";
import { Checkbox } from "@/web/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Switch } from "@/web/components/ui/switch";

import { ModelFormDialog } from "./model-form-dialog";
import { SyncPricesDialog } from "./sync-prices-dialog";

export function ProviderModelList({
  provider,
  onBack,
}: {
  provider: AiProvider;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data: models = [], isLoading: modelsLoading } = useAiModels(provider.id);
  const updateModel = useUpdateAiModel();
  const deleteModel = useDeleteAiModel();
  const batchDelete = useBatchDeleteAiModels();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiModel | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [cleanZeroOpen, setCleanZeroOpen] = useState(false);

  const zeroPriceModels = useMemo(
    () => models.filter((m) => m.inputPrice === "0" && m.outputPrice === "0"),
    [models],
  );

  const allSelected = models.length > 0 && selected.size === models.length;

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
      setSelected(new Set(models.map((m) => m.id)));
    }
  }, [allSelected, models]);

  const handleToggle = useCallback(
    async (model: AiModel) => {
      try {
        await updateModel.mutateAsync({
          id: model.id,
          providerId: model.providerId,
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
      await deleteModel.mutateAsync({ id: deleteTarget.id, providerId: deleteTarget.providerId });
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
      const result = await batchDelete.mutateAsync({ ids, providerId: provider.id });
      toast.success(t("ai-models.toast.batch-deleted", { count: result.deleted }));
      setSelected(new Set());
      setBatchDeleteOpen(false);
    } catch {
      toast.error(t("ai-models.toast.delete-error"));
    }
  }, [selected, batchDelete, provider.id, t]);

  const handleCleanZeroPrice = useCallback(async () => {
    const ids = zeroPriceModels.map((m) => m.id);
    if (ids.length === 0) return;
    try {
      const result = await batchDelete.mutateAsync({ ids, providerId: provider.id });
      toast.success(t("ai-models.toast.batch-deleted", { count: result.deleted }));
      setCleanZeroOpen(false);
    } catch {
      toast.error(t("ai-models.toast.delete-error"));
    }
  }, [zeroPriceModels, batchDelete, provider.id, t]);
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
          <DataTableBadge variant="secondary" className="font-mono">
            {row.original.modelId}
          </DataTableBadge>
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
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "inputPrice",
        cell: ({ row }) => (
          <DataTableText
            mono
            numeric
            className={
              row.original.inputPrice === "0" && row.original.outputPrice === "0"
                ? "text-yellow-600"
                : undefined
            }
          >
            ${row.original.inputPrice}
          </DataTableText>
        ),
        header: t("ai-models.th.input-price"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "outputPrice",
        cell: ({ row }) => (
          <DataTableText
            mono
            numeric
            className={
              row.original.inputPrice === "0" && row.original.outputPrice === "0"
                ? "text-yellow-600"
                : undefined
            }
          >
            ${row.original.outputPrice}
          </DataTableText>
        ),
        header: t("ai-models.th.output-price"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "capabilities",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.capabilities.map((capability) => (
              <DataTableBadge key={capability} variant="outline">
                {capability}
              </DataTableBadge>
            ))}
          </div>
        ),
        header: t("ai-models.th.capabilities"),
        meta: { headerClassName: "w-[18%]" },
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
        meta: { headerClassName: "w-[10%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditTarget(row.original)}
              aria-label={t("common.btn.edit")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
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
      selected,
      t,
      updateModel.isPending,
    ],
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label={t("common.btn.back")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2">
                {provider.iconUrl ? (
                  <img
                    src={provider.iconUrl}
                    alt={provider.name}
                    className="h-6 w-6 rounded object-contain"
                    width={24}
                    height={24}
                  />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <h2 className="text-base font-semibold">{provider.name}</h2>
              </div>
            </div>
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
              {models.length > 0 && selected.size === 0 && (
                <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {t("ai-models.btn.sync-prices")}
                </Button>
              )}
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("ai-models.btn.new")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={models}
            emptyText={t("ai-models.empty")}
            getRowId={(row) => String(row.id)}
            loading={modelsLoading}
            rowClassName={(row) =>
              row.inputPrice === "0" && row.outputPrice === "0"
                ? "bg-yellow-50/50 dark:bg-yellow-950/10"
                : undefined
            }
            showPagination={false}
            tableClassName="min-w-[1080px]"
          />
        </CardContent>
      </Card>

      <ModelFormDialog open={addOpen} onOpenChange={setAddOpen} providerId={provider.id} />

      {editTarget && (
        <ModelFormDialog
          open={!!editTarget}
          onOpenChange={(v) => {
            if (!v) setEditTarget(null);
          }}
          providerId={editTarget.providerId}
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

      <SyncPricesDialog open={syncOpen} onOpenChange={setSyncOpen} providerId={provider.id} />
    </>
  );
}
