import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useNotificationConfigs,
  useNotificationEvents,
  useTestNotificationConfig,
  useUpdateNotificationConfig,
} from "@/web/api/hooks";
import type { NotificationConfig } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

import { ConfigDialog } from "./config-dialog";
import { DeleteConfigDialog } from "./delete-config-dialog";
import { useChannelLabels } from "./use-channel-labels";

export function ChannelsTab() {
  const { t } = useTranslation();
  const channelLabels = useChannelLabels();
  const { data: configs = [], isLoading } = useNotificationConfigs();
  const { data: eventsData } = useNotificationEvents();
  const updateConfig = useUpdateNotificationConfig();
  const testConfig = useTestNotificationConfig();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotificationConfig | null>(null);

  async function handleToggleEnabled(config: NotificationConfig, checked: boolean) {
    try {
      await updateConfig.mutateAsync({ id: config.id, enabled: checked });
      toast.success(t("notif.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("notif.toast.update-error"));
    }
  }

  async function handleTest(id: number) {
    try {
      const result = await testConfig.mutateAsync(id);
      if (result.success) {
        toast.success(result.message || t("notif.toast.test-ok"));
      } else {
        toast.error(result.message || t("notif.toast.test-fail"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("notif.toast.test-fail"));
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("notif.btn.add")}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="animate-spin">
                <Loader2 className="h-5 w-5 text-muted-foreground" />
              </span>
            </div>
          ) : configs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("notif.table-empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("notif.th.label")}</TableHead>
                  <TableHead>{t("notif.th.channel")}</TableHead>
                  <TableHead>{t("notif.th.target")}</TableHead>
                  <TableHead>{t("notif.th.events")}</TableHead>
                  <TableHead>{t("notif.th.enabled")}</TableHead>
                  <TableHead>{t("notif.th.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((cfg) => (
                  <TableRow key={cfg.id}>
                    <TableCell className="font-medium">{cfg.label || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{channelLabels[cfg.channel] ?? cfg.channel}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {cfg.target}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{cfg.events.length}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={cfg.enabled}
                        onCheckedChange={(checked) => handleToggleEnabled(cfg, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleTest(cfg.id)}
                          disabled={testConfig.isPending}
                          aria-label={t("common.a11y.test")}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditing(cfg)}
                          aria-label={t("common.btn.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteTarget(cfg)}
                          aria-label={t("common.btn.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Create dialog */}
      <ConfigDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        enabledChannels={eventsData?.enabledChannels ?? []}
        groups={eventsData?.groups ?? []}
      />

      {/* Edit dialog */}
      {editing && (
        <ConfigDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          config={editing}
          enabledChannels={eventsData?.enabledChannels ?? []}
          groups={eventsData?.groups ?? []}
        />
      )}

      {/* Delete confirmation dialog */}
      <DeleteConfigDialog config={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
