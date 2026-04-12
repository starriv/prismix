import { useTranslation } from "react-i18next";

import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

export function ClearConfirmDialog({
  open,
  onOpenChange,
  channelName,
  onClear,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channelName: string;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("admin.notif.confirm-clear-title", { channel: channelName })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("admin.notif.confirm-clear-desc")}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={onClear}>
            {t("admin.notif.confirm-clear-btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
