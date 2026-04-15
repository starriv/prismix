import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useNotificationConfigs,
  useNotificationEvents,
  useTestNotificationConfig,
  useUpdateNotificationConfig,
} from "@/web/api/hooks";
import type { NotificationConfig } from "@/web/api/schemas";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Switch } from "@/web/components/ui/switch";

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

  const handleToggleEnabled = useCallback(
    async (config: NotificationConfig, checked: boolean) => {
      try {
        await updateConfig.mutateAsync({ id: config.id, enabled: checked });
        toast.success(t("notif.toast.updated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("notif.toast.update-error"));
      }
    },
    [updateConfig, t],
  );

  const handleTest = useCallback(
    async (id: number) => {
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
    },
    [testConfig, t],
  );

  const columns = useMemo<ColumnDef<NotificationConfig>[]>(
    () => [
      {
        accessorKey: "label",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.label || "-"}</DataTableText>
        ),
        header: t("notif.th.label"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "channel",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">
            {channelLabels[row.original.channel] ?? row.original.channel}
          </DataTableBadge>
        ),
        header: t("notif.th.channel"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "target",
        cell: ({ row }) => (
          <DataTableText className="max-w-[200px]" mono truncate>
            {row.original.target}
          </DataTableText>
        ),
        header: t("notif.th.target"),
        meta: { headerClassName: "w-[24%]" },
      },
      {
        accessorKey: "events",
        cell: ({ row }) => (
          <DataTableBadge variant="secondary">{row.original.events.length}</DataTableBadge>
        ),
        header: t("notif.th.events"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            onCheckedChange={(checked) => void handleToggleEnabled(row.original, checked)}
          />
        ),
        header: t("notif.th.enabled"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void handleTest(row.original.id)}
              disabled={testConfig.isPending}
              aria-label={t("common.a11y.test")}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setEditing(row.original)}
              aria-label={t("common.btn.edit")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t("common.btn.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: t("notif.th.actions"),
        meta: { headerClassName: "w-[20%]", ...dataTableMeta.right },
      },
    ],
    [handleToggleEnabled, handleTest, channelLabels, testConfig.isPending, t],
  );

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("notif.btn.add")}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={configs}
        emptyText={t("notif.table-empty")}
        getRowId={(row) => String(row.id)}
        loading={isLoading}
        showPagination={false}
        tableClassName="min-w-[920px]"
      />

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
