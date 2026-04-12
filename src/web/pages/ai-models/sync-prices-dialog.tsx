import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useApplySyncPrices, usePreviewSyncPrices } from "@/web/api/hooks";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { cn } from "@/web/shared/utils";

export function SyncPricesDialog({
  open,
  onOpenChange,
  providerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providerId: number;
}) {
  const { t } = useTranslation();
  const preview = usePreviewSyncPrices();
  const apply = useApplySyncPrices();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Fetch preview when dialog opens
  useEffect(() => {
    if (open) {
      preview.mutate({ providerId });
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerId]);

  // Auto-select all when preview data arrives
  const prevDataRef = useRef(preview.data);
  useEffect(() => {
    if (preview.data && preview.data !== prevDataRef.current) {
      setSelected(new Set(preview.data.map((d) => d.id)));
      prevDataRef.current = preview.data;
    }
  }, [preview.data]);

  const diffs = preview.data ?? [];
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
      const result = await apply.mutateAsync({ providerId, modelIds: [...selected] });
      toast.success(t("ai-models.toast.prices-synced", { count: result.synced }));
      onOpenChange(false);
    } catch {
      toast.error(t("ai-models.toast.sync-error"));
    }
  }, [selected, apply, providerId, t, onOpenChange]);

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allSelected} onCheckedChange={handleToggleAll} />
                  </TableHead>
                  <TableHead>{t("ai-models.sync.th-model")}</TableHead>
                  <TableHead className="text-right">{t("ai-models.sync.th-input-price")}</TableHead>
                  <TableHead className="text-right">
                    {t("ai-models.sync.th-output-price")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(d.id)}
                        onCheckedChange={() => handleToggleOne(d.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {d.modelId}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <PriceCell oldVal={d.oldInputPrice} newVal={d.newInputPrice} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PriceCell oldVal={d.oldOutputPrice} newVal={d.newOutputPrice} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
