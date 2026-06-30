import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { parseFiatConfigCurrency } from "@/shared/number";
import { useFiatConfigs, useUpdateFiatConfig } from "@/web/api/hooks";
import type { FiatConfig } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { DataTable, dataTableMeta, DataTableText } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Switch } from "@/web/components/ui/switch";

import { ConfigDialog } from "./config-dialog";
import { DeleteConfigDialog } from "./delete-config-dialog";
import { MethodBadge } from "./method-badge";

export default function FiatConfigsPage() {
  const { t } = useTranslation();
  const { data: configs = [], isLoading } = useFiatConfigs();
  const updateConfig = useUpdateFiatConfig();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FiatConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FiatConfig | null>(null);

  const handleToggleEnabled = useCallback(
    async (cfg: FiatConfig, checked: boolean) => {
      try {
        await updateConfig.mutateAsync({ id: cfg.id, enabled: checked });
        toast.success(t("fiat.toast.updated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("fiat.toast.update-error"));
      }
    },
    [updateConfig, t],
  );

  const getConfigCurrency = useCallback((cfg: FiatConfig) => {
    return parseFiatConfigCurrency(cfg.config) ?? "—";
  }, []);

  const columns = useMemo<ColumnDef<FiatConfig>[]>(
    () => [
      {
        accessorKey: "displayName",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.displayName}</DataTableText>
        ),
        header: t("fiat.th.display-name"),
        meta: { headerClassName: "w-[24%]" },
      },
      {
        accessorKey: "method",
        cell: ({ row }) => (
          <MethodBadge
            method={row.original.method}
            label={t(`fiat.method.${row.original.method}`)}
          />
        ),
        header: t("fiat.th.method"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        id: "currency",
        cell: ({ row }) => <DataTableText mono>{getConfigCurrency(row.original)}</DataTableText>,
        header: t("fiat.th.currency"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            onCheckedChange={(checked) => void handleToggleEnabled(row.original, checked)}
          />
        ),
        header: t("fiat.th.enabled"),
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
        header: t("fiat.th.actions"),
        meta: { headerClassName: "w-[20%]", ...dataTableMeta.right },
      },
    ],
    [handleToggleEnabled, getConfigCurrency, t],
  );

  return (
    <div>
      <Header title={t("fiat.title")} description={t("fiat.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("fiat.btn.add")}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={configs}
          emptyText={t("fiat.table-empty")}
          getRowId={(row) => String(row.id)}
          loading={isLoading}
          showPagination={false}
          tableClassName="min-w-[900px]"
        />
      </div>

      <ConfigDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {editing && (
        <ConfigDialog open={!!editing} onClose={() => setEditing(null)} config={editing} />
      )}

      <DeleteConfigDialog config={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
