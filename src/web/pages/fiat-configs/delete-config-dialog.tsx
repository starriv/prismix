import { useTranslation } from "react-i18next";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useDeleteFiatConfig } from "@/web/api/hooks";
import type { FiatConfig } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

interface DeleteConfigDialogProps {
  config: FiatConfig | null;
  onClose: () => void;
}

export function DeleteConfigDialog({ config, onClose }: DeleteConfigDialogProps) {
  const { t } = useTranslation();
  const deleteConfig = useDeleteFiatConfig();

  async function handleDelete() {
    if (!config) return;
    try {
      await deleteConfig.mutateAsync(config.id);
      toast.success(t("fiat.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("fiat.toast.delete-error"));
    }
  }

  return (
    <Dialog open={!!config} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("fiat.delete-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("fiat.delete-confirm")}</p>
          {config && (
            <p className="mt-2 text-sm font-medium">
              {config.displayName} &mdash; {t(`fiat.method.${config.method}`)}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteConfig.isPending}>
            {deleteConfig.isPending && (
              <span className="animate-spin">
                <Loader2 className="mr-2 h-4 w-4" />
              </span>
            )}
            {t("fiat.btn.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
