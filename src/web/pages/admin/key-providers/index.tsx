import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { BarChart3, Plus } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { useKeyProviders } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Sheet, SheetContent } from "@/web/components/ui/sheet";

import { KEY_PROVIDER_STATUS_COLORS } from "./constants";
import { CreateKeyProviderDialog } from "./create-dialog";
import { KeyProviderDetailSheet } from "./detail-sheet";

export default function KeyProvidersPage() {
  const { t, i18n } = useTranslation();
  const { data: providers = [] } = useKeyProviders();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const keyProviderStatusMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(KEY_PROVIDER_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`common.status.${key}`), className },
        ]),
      ),
    [t],
  );

  const editing = useMemo(
    () => (editingId ? (providers.find((p) => p.id === editingId) ?? null) : null),
    [editingId, providers],
  );
  const columns = useMemo<ColumnDef<(typeof providers)[number]>[]>(
    () => [
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("common.th.name"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "revenueSharePercent",
        cell: ({ row }) => <DataTableText>{row.original.revenueSharePercent}%</DataTableText>,
        header: t("admin.key-providers.th.share"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "balance",
        cell: ({ row }) => (
          <DataTableText mono>{`$${removeTailingZero(row.original.balance)}`}</DataTableText>
        ),
        header: t("admin.key-providers.th.balance"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "keyCount",
        cell: ({ row }) => (
          <DataTableBadge variant="secondary">{row.original.keyCount ?? 0}</DataTableBadge>
        ),
        header: t("admin.key-providers.th.keys"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} colorMap={keyProviderStatusMap} />
        ),
        header: t("common.th.status"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("common.th.time"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-right">
            <Button variant="ghost" size="sm" asChild onClick={(event) => event.stopPropagation()}>
              <LocaleLink to={`/admin/key-provider-usage-detail?id=${row.original.id}`}>
                <BarChart3 className="h-3.5 w-3.5" />
              </LocaleLink>
            </Button>
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
      },
    ],
    [i18n.language, keyProviderStatusMap, t],
  );

  return (
    <div>
      <Header title={t("admin.key-providers.title")} description={t("admin.key-providers.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("admin.key-providers.btn.create")}
          </Button>
        </div>

        <Card>
          <CardContent>
            <DataTable
              columns={columns}
              data={providers}
              emptyText={t("admin.key-providers.table-empty")}
              getRowId={(row) => String(row.id)}
              loading={false}
              onRowClick={(row) => setEditingId(row.id)}
              showPagination={false}
              tableClassName="min-w-[900px]"
            />
          </CardContent>
        </Card>
      </div>

      <CreateKeyProviderDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Sheet open={!!editing} onOpenChange={() => setEditingId(null)}>
        <SheetContent className="w-full sm:w-[480px]">
          {editing && (
            <KeyProviderDetailSheet providerId={editing.id} onClose={() => setEditingId(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
