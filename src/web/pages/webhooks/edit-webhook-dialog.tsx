import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { union } from "lodash-es";
import { Loader2, Webhook } from "lucide-react";
import { toast } from "sonner";

import { useUpdateWebhook } from "@/web/api/hooks";
import type { WebhookEndpoint } from "@/web/api/schemas";
import { updateWebhookEndpointBody } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";

import { EventCheckboxField } from "./webhook-helpers";

// ── Edit Webhook Dialog ──────────────────────────────────────────────

interface EditWebhookDialogProps {
  open: boolean;
  onClose: () => void;
  endpoint: WebhookEndpoint;
  groups: { key: string; events: string[] }[];
}

export function EditWebhookDialog({ open, onClose, endpoint, groups }: EditWebhookDialogProps) {
  const { t } = useTranslation();
  const updateWebhook = useUpdateWebhook();

  const form = useForm({
    resolver: zodResolver(updateWebhookEndpointBody),
    defaultValues: {
      url: endpoint.url,
      description: endpoint.description,
      events: endpoint.events,
      status: endpoint.status as "active" | "paused",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        url: endpoint.url,
        description: endpoint.description,
        events: endpoint.events,
        status: endpoint.status as "active" | "paused",
      });
    }
  }, [open, endpoint, form]);

  const selectedEvents = form.watch("events") ?? [];

  const toggleEvent = useCallback(
    (event: string) => {
      const current = form.getValues("events") ?? [];
      if (current.includes(event)) {
        form.setValue(
          "events",
          current.filter((e) => e !== event),
          { shouldValidate: true },
        );
      } else {
        form.setValue("events", [...current, event], { shouldValidate: true });
      }
    },
    [form],
  );

  const toggleGroupAll = useCallback(
    (events: string[]) => {
      const current = form.getValues("events") ?? [];
      const allSelected = events.every((e) => current.includes(e));
      if (allSelected) {
        form.setValue(
          "events",
          current.filter((e) => !events.includes(e)),
          { shouldValidate: true },
        );
      } else {
        form.setValue("events", union(current, events), { shouldValidate: true });
      }
    },
    [form],
  );

  const watchedStatus = form.watch("status");

  const handleStatusToggle = useCallback(
    (checked: boolean) => {
      form.setValue("status", checked ? "active" : "paused");
    },
    [form],
  );

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await updateWebhook.mutateAsync({ id: endpoint.id, ...data });
      toast.success(t("webhook.toast.updated"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhook.toast.update-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent preventClose className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Webhook className="inline h-5 w-5 mr-2" />
            {t("webhook.dialog-title-edit")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              {/* URL */}
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("webhook.form.url")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("webhook.form.url-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("webhook.form.description")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("webhook.form.description-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Events grouped — collapsible */}
              <EventCheckboxField
                control={form.control}
                groups={groups}
                selectedEvents={selectedEvents}
                toggleEvent={toggleEvent}
                toggleGroupAll={toggleGroupAll}
              />

              {/* Status toggle */}
              <div className="flex items-center gap-2">
                <Switch checked={watchedStatus === "active"} onCheckedChange={handleStatusToggle} />
                <Label>{t("webhook.card.status")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t(`webhook.status.${watchedStatus ?? "active"}`)}
                </span>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={updateWebhook.isPending}>
                {updateWebhook.isPending && (
                  <span className="animate-spin">
                    <Loader2 className="mr-2 h-4 w-4" />
                  </span>
                )}
                {t("webhook.btn.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
