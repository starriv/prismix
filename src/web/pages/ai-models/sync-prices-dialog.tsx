import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useApplySyncPrices, usePreviewSyncPrices } from "@/web/api/hooks";
import { DataTable, DataTableBadge } from "@/web/components/data-table";
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
import { cn } from "@/web/shared/utils";

export function SyncPricesDialog({
  open,
  onOpenChange,
  endpointId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  endpointId: number;
}) {
  const { t } = useTranslation();
  const preview = usePreviewSyncPrices();
  const apply = useApplySyncPrices();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Fetch preview when dialog opens
  useEffect(() => {
    if (open) {
      preview.mutate({ endpointId });
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpointId]);

  // Auto-select all when preview data arrives
  const prevDataRef = useRef(preview.data);
  useEffect(() => {
    if (preview.data && preview.data !== prevDataRef.current) {
      setSelected(new Set(preview.data.map((d) => d.id)));
      prevDataRef.current = preview.data;
    }
  }, [preview.data]);

  const diffs = useMemo(() => preview.data ?? [], [preview.data]);
  const allSelected = diffs.length > 0 && selected.size === diffs.length;

  const handleToggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === diffs.length ? new Set() : new Set(diffs.map((d) => d.id)),
    );
  }, [diffs]);

  const handleToggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      const result = await apply.mutateAsync({ endpointId, modelIds: [...selected] });
      toast.success(t("ai-models.toast.prices-synced", { count: result.synced }));
      onOpenChange(false);
    } catch {
      toast.error(t("ai-models.toast.sync-error"));
    }
  }, [selected, apply, endpointId, t, onOpenChange]);
  const columns = useMemo<ColumnDef<(typeof diffs)[number]>[]>(
    () => [
      {
        id: "select",
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={() => handleToggleOne(row.original.id)}
          />
        ),
        enableHiding: false,
        header: () => <Checkbox checked={allSelected} onCheckedChange={handleToggleAll} />,
        meta: { headerClassName: "w-8" },
      },
      {
        accessorKey: "modelId",
        cell: ({ row }) => (
          <DataTableBadge variant="secondary" className="font-mono">
            {row.original.modelId}
          </DataTableBadge>
        ),
        header: t("ai-models.sync.th-model"),
        meta: { headerClassName: "w-[34%]" },
      },
      {
        accessorKey: "oldInputPrice",
        cell: ({ row }) => (
          <PriceCell oldVal={row.original.oldInputPrice} newVal={row.original.newInputPrice} />
        ),
        header: t("ai-models.sync.th-input-price"),
        meta: { headerClassName: "w-[29%] text-right" },
      },
      {
        accessorKey: "oldOutputPrice",
        cell: ({ row }) => (
          <PriceCell oldVal={row.original.oldOutputPrice} newVal={row.original.newOutputPrice} />
        ),
        header: t("ai-models.sync.th-output-price"),
        meta: { headerClassName: "w-[29%] text-right" },
      },
    ],
    [selected, allSelected, handleToggleAll, handleToggleOne, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("ai-models.sync.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("ai-models.sync.desc")}</p>
        </DialogHeader>
        <DialogBody>
          {preview.isPending ? (
            <div className="flex items-center gap-2 py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t("ai-models.discover.loading")}
              </span>
            </div>
          ) : diffs.length === 0 ? (
            <div className="py-8 text-center">
              <RefreshCw className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">{t("ai-models.sync.no-diff")}</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={diffs}
              emptyText={t("ai-models.sync.no-diff")}
              getRowId={(row) => String(row.id)}
              loading={false}
              showPagination={false}
              tableClassName="min-w-[720px]"
            />
          )}
        </DialogBody>
        {diffs.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.btn.cancel")}
            </Button>
            <Button onClick={handleApply} disabled={selected.size === 0 || apply.isPending}>
              {apply.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t("ai-models.sync.apply", { count: selected.size })}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PriceCell({ oldVal, newVal }: { oldVal: string; newVal: string }) {
  const changed = oldVal !== newVal;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          changed && "text-muted-foreground line-through",
        )}
      >
        ${oldVal}
      </span>
      {changed && <span className="font-mono text-xs tabular-nums text-green-600">${newVal}</span>}
    </div>
  );
}
