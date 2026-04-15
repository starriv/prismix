import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useNotificationLogs } from "@/web/api/hooks";
import type { NotificationLog } from "@/web/api/schemas";
import {
  DataTable,
  DataTableBadge,
  DataTableRelativeTime,
  DataTableText,
  getHeuristicPageCount,
} from "@/web/components/data-table";
import { cn } from "@/web/shared/utils";

import { useChannelLabels } from "./use-channel-labels";

export function LogsTab() {
  const { t, i18n } = useTranslation();
  const channelLabels = useChannelLabels();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const { data: logs = [], isLoading } = useNotificationLogs({ page: pagination.pageIndex });
  const columns = useMemo<ColumnDef<NotificationLog>[]>(
    () => [
      {
        accessorKey: "event",
        cell: ({ row }) => <DataTableText mono>{row.original.event}</DataTableText>,
        header: t("notif.logs-th.event"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "channel",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">
            {channelLabels[row.original.channel] ?? row.original.channel}
          </DataTableBadge>
        ),
        header: t("notif.logs-th.channel"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "target",
        cell: ({ row }) => (
          <DataTableText className="max-w-[200px]" mono truncate>
            {row.original.target}
          </DataTableText>
        ),
        header: t("notif.logs-th.target"),
        meta: { headerClassName: "w-[24%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => <LogStatusBadge status={row.original.status} t={t} />,
        header: t("notif.logs-th.status"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("notif.logs-th.time"),
        meta: { headerClassName: "w-[22%]" },
      },
    ],
    [channelLabels, i18n.language, t],
  );

  return (
    <div className="space-y-4 mt-4">
      <DataTable
        columns={columns}
        data={logs}
        emptyText={t("notif.logs-empty")}
        getRowId={(row) => String(row.id)}
        loading={isLoading}
        manualPagination
        onPaginationChange={setPagination}
        pageCount={getHeuristicPageCount(pagination.pageIndex, logs.length, DEFAULT_PAGE_SIZE)}
        pagination={pagination}
        tableClassName="min-w-[840px]"
      />
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────────────

function LogStatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  return (
    <DataTableBadge
      variant="outline"
      className={cn(
        "text-xs",
        status === "sent" && "border-green-500/30 bg-green-500/10 text-green-600",
        status === "failed" && "border-destructive/30 bg-destructive/10 text-destructive",
        status === "pending" && "",
      )}
    >
      {t(`notif.log-status.${status}`)}
    </DataTableBadge>
  );
}
