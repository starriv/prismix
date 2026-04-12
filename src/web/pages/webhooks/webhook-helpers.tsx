import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, Check, ChevronDown, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useDeleteWebhook, useRotateWebhookSecret } from "@/web/api/hooks";
import type { WebhookEndpoint } from "@/web/api/schemas";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { FormField, FormItem, FormLabel, FormMessage } from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyControl = any;

// ── Event Checkbox Field (shared) ────────────────────────────────────

interface EventCheckboxFieldProps {
  control: AnyControl;
  groups: { key: string; events: string[] }[];
  selectedEvents: string[];
  toggleEvent: (event: string) => void;
  toggleGroupAll: (events: string[]) => void;
}

export function EventCheckboxField({
  control,
  groups,
  selectedEvents,
  toggleEvent,
  toggleGroupAll,
}: EventCheckboxFieldProps) {
  const { t } = useTranslation();

  return (
    <FormField
      control={control}
      name="events"
      render={() => (
        <FormItem>
          <FormLabel>{t("webhook.form.events")}</FormLabel>
          <div className="space-y-1 rounded-md border p-2">
            {groups.map((group) => {
              const allChecked = group.events.every((e) => selectedEvents.includes(e));
              const someChecked = group.events.some((e) => selectedEvents.includes(e));
              const checkedCount = group.events.filter((e) => selectedEvents.includes(e)).length;
              return (
                <Collapsible key={group.key}>
                  <div className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked && !allChecked;
                      }}
                      onChange={() => toggleGroupAll(group.events)}
                    />
                    <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 cursor-pointer hover:underline">
                      <span className="text-sm font-medium">{t(`webhook.group.${group.key}`)}</span>
                      {checkedCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1">
                          {checkedCount}/{group.events.length}
                        </Badge>
                      )}
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform [[data-state=open]>&]:rotate-180" />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <div className="ml-6 pb-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {group.events.map((event) => (
                        <label key={event} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-input accent-primary"
                            checked={selectedEvents.includes(event)}
                            onChange={() => toggleEvent(event)}
                          />
                          <span className="text-xs text-muted-foreground">
                            {t(`webhook.event.${event.replace(/\./g, "-")}`)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ── Secret Display Dialog ────────────────────────────────────────────

export function SecretDisplayDialog({
  endpoint,
  onClose,
}: {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!endpoint) return;
    navigator.clipboard.writeText(endpoint.secret);
    setCopied(true);
    toast.success(t("webhook.toast.copied"));
    setTimeout(() => setCopied(false), 2000);
  }, [endpoint, t]);

  return (
    <Dialog open={!!endpoint} onOpenChange={(v) => !v && onClose()}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("webhook.secret.title")}</DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t("webhook.secret.warn")}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("webhook.secret.label")}</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={endpoint?.secret ?? ""} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={handleCopy}
                aria-label={t("common.a11y.copy")}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose} size="sm">
            {t("webhook.secret.btn-saved")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirm Dialog ────────────────────────────────────────────

export function DeleteConfirmDialog({
  endpoint,
  onClose,
}: {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteWebhook = useDeleteWebhook();

  const handleDelete = useCallback(async () => {
    if (!endpoint) return;
    try {
      await deleteWebhook.mutateAsync(endpoint.id);
      toast.success(t("webhook.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhook.toast.delete-error"));
    }
  }, [endpoint, deleteWebhook, t, onClose]);

  return (
    <Dialog open={!!endpoint} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("webhook.delete-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("webhook.delete-confirm")}</p>
          {endpoint && <p className="mt-2 text-sm font-mono truncate">{endpoint.url}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteWebhook.isPending}>
            {deleteWebhook.isPending && (
              <span className="animate-spin">
                <Loader2 className="mr-2 h-4 w-4" />
              </span>
            )}
            {t("webhook.btn.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rotate Confirm Dialog ────────────────────────────────────────────

export function RotateConfirmDialog({
  endpoint,
  onClose,
  onRotated,
}: {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
  onRotated: (ep: WebhookEndpoint) => void;
}) {
  const { t } = useTranslation();
  const rotateSecret = useRotateWebhookSecret();

  const handleRotate = useCallback(async () => {
    if (!endpoint) return;
    try {
      const rotated = await rotateSecret.mutateAsync(endpoint.id);
      toast.success(t("webhook.toast.rotated"));
      onClose();
      onRotated(rotated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhook.toast.rotate-error"));
    }
  }, [endpoint, rotateSecret, t, onClose, onRotated]);

  return (
    <Dialog open={!!endpoint} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("webhook.rotate.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("webhook.rotate.desc")}</p>
          {endpoint && <p className="mt-2 text-sm font-mono truncate">{endpoint.url}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleRotate} disabled={rotateSecret.isPending}>
            {rotateSecret.isPending && (
              <span className="animate-spin">
                <Loader2 className="mr-2 h-4 w-4" />
              </span>
            )}
            {t("webhook.btn.rotate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Status Badges ────────────────────────────────────────────────────

const ENDPOINT_STATUS_COLORS: Record<string, string> = {
  active: "border-green-500/30 bg-green-500/10 text-green-600",
  paused: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  disabled: "border-destructive/30 bg-destructive/10 text-destructive",
};

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  success: "border-green-500/30 bg-green-500/10 text-green-600",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function EndpointStatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const colorMap = Object.fromEntries(
    Object.entries(ENDPOINT_STATUS_COLORS).map(([key, className]) => [
      key,
      { label: t(`webhook.status.${key}`), className },
    ]),
  );
  return (
    <StatusBadge
      status={status}
      colorMap={colorMap}
      fallbackLabel={t(`webhook.status.${status}`)}
    />
  );
}

export function DeliveryStatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const colorMap = Object.fromEntries(
    Object.entries(DELIVERY_STATUS_COLORS).map(([key, className]) => [
      key,
      { label: t(`webhook.deliveries.status.${key}`), className },
    ]),
  );
  return (
    <StatusBadge
      status={status}
      colorMap={colorMap}
      fallbackLabel={t(`webhook.deliveries.status.${status}`)}
    />
  );
}
