import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { Copy, Trash2 } from "lucide-react";

import type { UserKey } from "@/web/api/schemas";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Switch } from "@/web/components/ui/switch";

export function buildUserKeyColumns({
  handleCopy,
  handleDelete,
  handleToggle,
  isCopyPending,
  isStatusPending,
  language,
  t,
}: {
  handleCopy: (id: number) => void;
  handleDelete: (key: UserKey) => void;
  handleToggle: (key: UserKey, enabled: boolean) => void;
  isCopyPending: boolean;
  isStatusPending: boolean;
  language: string;
  t: TFunction;
}): ColumnDef<UserKey>[] {
  return [
    {
      accessorKey: "name",
      cell: ({ row }) => <DataTableText className="font-medium">{row.original.name}</DataTableText>,
      header: t("user.keys.th.name"),
    },
    {
      accessorKey: "apiKeyPrefix",
      cell: ({ row }) => <DataTableText mono>{row.original.apiKeyPrefix}...</DataTableText>,
      header: t("user.keys.th.prefix"),
    },
    {
      accessorKey: "status",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.original.status === "active"}
            onCheckedChange={(enabled) => handleToggle(row.original, enabled)}
            disabled={isStatusPending}
            aria-label={t("user.keys.action.toggle")}
          />
          <DataTableText className="text-xs text-muted-foreground">
            {t(
              row.original.status === "active"
                ? "user.keys.status.active"
                : "user.keys.status.suspended",
            )}
          </DataTableText>
        </div>
      ),
      header: t("user.keys.th.status"),
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      header: t("user.keys.th.created"),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleCopy(row.original.id)}
            disabled={isCopyPending}
            aria-label={t("common.a11y.copy")}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleDelete(row.original)}
            disabled={isStatusPending}
            aria-label={t("user.keys.action.delete")}
            title={t("user.keys.action.delete")}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
      enableHiding: false,
      header: "",
      meta: {
        headerClassName: "w-[76px]",
        ...dataTableMeta.right,
      },
    },
  ];
}
