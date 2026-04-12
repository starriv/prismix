import { useCallback, useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { union } from "lodash-es";
import { Loader2, Webhook } from "lucide-react";
import { toast } from "sonner";

import { useCreateWebhook } from "@/web/api/hooks";
import type { CreateWebhookEndpointBody, WebhookEndpoint } from "@/web/api/schemas";
import { createWebhookEndpointBody } from "@/web/api/schemas";
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

import { EventCheckboxField } from "./webhook-helpers";

// ── Create Webhook Dialog ────────────────────────────────────────────

interface CreateWebhookDialogProps {
  open: boolean;
  onClose: () => void;
  groups: { key: string; events: string[] }[];
  onSuccess: (ep: WebhookEndpoint) => void;
}

export function CreateWebhookDialog({
  open,
  onClose,
  groups,
  onSuccess,
}: CreateWebhookDialogProps) {
  const { t } = useTranslation();
  const createWebhook = useCreateWebhook();

  const form = useForm<CreateWebhookEndpointBody>({
    resolver: zodResolver(createWebhookEndpointBody) as Resolver<CreateWebhookEndpointBody>,
    defaultValues: { url: "", description: "", events: [] },
  });

  useEffect(() => {
    if (open) {
      form.reset({ url: "", description: "", events: [] });
    }
  }, [open, form]);

  const selectedEvents = form.watch("events");

  const toggleEvent = useCallback(
    (event: string) => {
      const current = form.getValues("events");
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
      const current = form.getValues("events");
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

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const created = await createWebhook.mutateAsync(data);
      toast.success(t("webhook.toast.created"));
      onSuccess(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhook.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent preventClose className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Webhook className="inline h-5 w-5 mr-2" />
            {t("webhook.dialog-title-create")}
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
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={createWebhook.isPending}>
                {createWebhook.isPending && (
                  <span className="animate-spin">
                    <Loader2 className="mr-2 h-4 w-4" />
                  </span>
                )}
                {t("webhook.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
