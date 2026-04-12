import { useTranslation } from "react-i18next";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useDeleteNotificationConfig } from "@/web/api/hooks";
import type { NotificationConfig } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

export function DeleteConfigDialog({
  config,
  onClose,
}: {
  config: NotificationConfig | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteConfig = useDeleteNotificationConfig();

  async function handleDelete() {
    if (!config) return;
    try {
      await deleteConfig.mutateAsync(config.id);
      toast.success(t("notif.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("notif.toast.delete-error"));
    }
  }

  return (
    <Dialog open={!!config} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("notif.delete-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("notif.delete-confirm")}</p>
          {config && (
            <p className="mt-2 text-sm font-medium">
              {config.label || config.channel} &mdash; {config.target}
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
            {t("notif.btn.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
