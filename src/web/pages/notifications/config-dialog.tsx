import { useEffect, useMemo } from "react";
import type { Resolver } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { union } from "lodash-es";
import { Bell, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useCreateNotificationConfig, useUpdateNotificationConfig } from "@/web/api/hooks";
import type {
  CreateNotificationConfigBody,
  NotificationConfig,
  NotificationEventGroup,
} from "@/web/api/schemas";
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
import { SecretInput } from "@/web/components/ui/secret-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";

import { useChannelLabels } from "./use-channel-labels";

// ── Form schema ─────────────────────────────────────────────────────

const configFormSchema = z.object({
  channel: z.string().min(1, "notif.valid.channel-required"),
  label: z.string().max(100),
  target: z.string().min(1, "notif.valid.target-required"),
  secret: z.string().max(500).optional(),
  events: z.array(z.string().min(1)).min(1, "notif.valid.events-required"),
  enabled: z.boolean(),
});

type ConfigFormValues = z.infer<typeof configFormSchema>;

// ── Types ───────────────────────────────────────────────────────────

interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
  config?: NotificationConfig;
  enabledChannels: string[];
  groups: NotificationEventGroup[];
}

export function ConfigDialog({
  open,
  onClose,
  config,
  enabledChannels,
  groups,
}: ConfigDialogProps) {
  const { t } = useTranslation();
  const createConfig = useCreateNotificationConfig();
  const updateConfig = useUpdateNotificationConfig();
  const isEdit = !!config;
  const configChannel = config?.channel;
  const selectableChannels = useMemo(() => {
    if (isEdit && configChannel) return union([configChannel], enabledChannels);
    return enabledChannels;
  }, [configChannel, enabledChannels, isEdit]);

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configFormSchema) as Resolver<ConfigFormValues>,
    defaultValues: {
      channel: config?.channel ?? selectableChannels[0] ?? "",
      label: config?.label ?? "",
      target: config?.target ?? "",
      secret: config?.secret ?? "",
      events: config?.events ?? [],
      enabled: config?.enabled ?? true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        channel: config?.channel ?? selectableChannels[0] ?? "",
        label: config?.label ?? "",
        target: config?.target ?? "",
        secret: config?.secret ?? "",
        events: config?.events ?? [],
        enabled: config?.enabled ?? true,
      });
    }
  }, [open, config, selectableChannels, form]);

  const selectedChannel = useWatch({ control: form.control, name: "channel" });
  const selectedEvents = useWatch({ control: form.control, name: "events" }) ?? [];
  const hasSelectableChannels = selectableChannels.length > 0;
  const hasEventGroups = groups.some((group) => group.events.length > 0);

  const targetPlaceholders: Record<string, string> = {
    email: t("notif.form.target-ph-email"),
    telegram: t("notif.form.target-ph-telegram"),
    webhook: t("notif.form.target-ph-webhook"),
    whatsapp: t("notif.form.target-ph-whatsapp"),
  };

  const channelLabels = useChannelLabels();

  function toggleEvent(event: string) {
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
  }

  function toggleGroupAll(events: string[]) {
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
  }

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      if (isEdit) {
        await updateConfig.mutateAsync({
          id: config.id,
          label: data.label,
          target: data.target,
          secret: data.secret || undefined,
          events: data.events,
          enabled: data.enabled,
        });
        toast.success(t("notif.toast.updated"));
      } else {
        await createConfig.mutateAsync(data as unknown as CreateNotificationConfigBody);
        toast.success(t("notif.toast.created"));
      }
      onClose();
    } catch (err) {
      const key = isEdit ? "notif.toast.update-error" : "notif.toast.create-error";
      toast.error(err instanceof Error ? err.message : t(key));
    }
  });

  const isPending = createConfig.isPending || updateConfig.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent preventClose className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Bell className="inline h-5 w-5 mr-2" />
            {isEdit ? t("notif.dialog-title-edit") : t("notif.dialog-title-create")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              {/* Channel */}
              <FormField
                control={form.control}
                name="channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("notif.form.channel")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isEdit || !hasSelectableChannels}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("notif.form.channel-ph")} />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableChannels.map((ch) => (
                          <SelectItem key={ch} value={ch}>
                            {channelLabels[ch] ?? ch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                    {!hasSelectableChannels && (
                      <p className="text-xs text-muted-foreground">
                        {t("notif.form.no-enabled-channels")}
                      </p>
                    )}
                  </FormItem>
                )}
              />

              {/* Label */}
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("notif.form.label")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("notif.form.label-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Target */}
              <FormField
                control={form.control}
                name="target"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("notif.form.target")}</FormLabel>
                    <FormControl>
                      <Input placeholder={targetPlaceholders[selectedChannel] ?? ""} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Secret (webhook only) */}
              {selectedChannel === "webhook" && (
                <FormField
                  control={form.control}
                  name="secret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("notif.form.secret")}</FormLabel>
                      <FormControl>
                        <SecretInput
                          placeholder={t("notif.form.secret-ph")}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Events grouped — collapsible */}
              <FormField
                control={form.control}
                name="events"
                render={() => (
                  <FormItem>
                    <FormLabel>{t("notif.form.events")}</FormLabel>
                    <div className="space-y-1 rounded-md border p-2">
                      {hasEventGroups ? (
                        groups.map((group) => {
                          const eventTypes = group.events.map((event) => event.type);
                          const allChecked = eventTypes.every((event) =>
                            selectedEvents.includes(event),
                          );
                          const someChecked = eventTypes.some((event) =>
                            selectedEvents.includes(event),
                          );
                          const checkedCount = eventTypes.filter((event) =>
                            selectedEvents.includes(event),
                          ).length;
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
                                  onChange={() => toggleGroupAll(eventTypes)}
                                />
                                <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 cursor-pointer hover:underline">
                                  <span className="text-sm font-medium">
                                    {t(group.labelKey, { defaultValue: group.key })}
                                  </span>
                                  {checkedCount > 0 && (
                                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                      {checkedCount}/{group.events.length}
                                    </Badge>
                                  )}
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform [[data-state=open]>&]:rotate-180" />
                                </CollapsibleTrigger>
                              </div>
                              <CollapsibleContent>
                                <div className="ml-6 space-y-1 pb-1.5">
                                  {group.events.map((event) => {
                                    const description = event.descriptionKey
                                      ? t(event.descriptionKey, { defaultValue: "" })
                                      : "";
                                    return (
                                      <label
                                        key={event.type}
                                        className="grid cursor-pointer grid-cols-[auto,1fr] gap-2 rounded-sm px-1 py-1 hover:bg-muted/50"
                                      >
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-3.5 w-3.5 rounded border-input accent-primary"
                                          checked={selectedEvents.includes(event.type)}
                                          onChange={() => toggleEvent(event.type)}
                                        />
                                        <span className="min-w-0">
                                          <span className="block text-xs text-foreground">
                                            {t(event.labelKey, { defaultValue: event.type })}
                                          </span>
                                          {description && (
                                            <span className="block text-[11px] leading-snug text-muted-foreground">
                                              {description}
                                            </span>
                                          )}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })
                      ) : (
                        <p className="px-1 py-2 text-xs text-muted-foreground">
                          {t("notif.form.events-unavailable")}
                        </p>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Enabled */}
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                    <Label>{t("notif.form.enabled")}</Label>
                  </div>
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                {t("common.btn.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isPending || !hasSelectableChannels || !hasEventGroups}
              >
                {isPending && (
                  <span className="animate-spin">
                    <Loader2 className="mr-2 h-4 w-4" />
                  </span>
                )}
                {isEdit ? t("notif.btn.save") : t("notif.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
