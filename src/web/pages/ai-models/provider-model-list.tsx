import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowLeft, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAiModels, useDeleteAiModel, useUpdateAiModel } from "@/web/api/hooks";
import type { AiModel, AiProvider } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Skeleton } from "@/web/components/ui/skeleton";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

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

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiModel | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

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
              {models.length > 0 && (
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
          {modelsLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : models.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{t("ai-models.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ai-models.th.model-id")}</TableHead>
                  <TableHead>{t("ai-models.th.name")}</TableHead>
                  <TableHead>{t("ai-models.th.input-price")}</TableHead>
                  <TableHead>{t("ai-models.th.output-price")}</TableHead>
                  <TableHead>{t("ai-models.th.capabilities")}</TableHead>
                  <TableHead>{t("ai-models.th.enabled")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {m.modelId}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      ${m.inputPrice}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      ${m.outputPrice}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.capabilities.map((cap) => (
                          <Badge key={cap} variant="outline" className="text-xs">
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={m.enabled}
                        onCheckedChange={() => handleToggle(m)}
                        disabled={updateModel.isPending}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditTarget(m)}
                          aria-label={t("common.btn.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(m)}
                          aria-label={t("common.btn.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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

      <SyncPricesDialog open={syncOpen} onOpenChange={setSyncOpen} providerId={provider.id} />
    </>
  );
}
