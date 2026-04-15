import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Plus } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";

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
import { Button } from "@/web/components/ui/button";

import { KEY_PROVIDER_STATUS_COLORS } from "./constants";
import { CreateKeyProviderDialog } from "./create-dialog";
import { KeyProviderDetailPage } from "./detail-page";

export default function KeyProvidersPage() {
  const { t, i18n } = useTranslation();
  const { data: providers = [], isLoading } = useKeyProviders();
  const [createOpen, setCreateOpen] = useState(false);
  const [providerId, setProviderId] = useQueryState("providerId", parseAsInteger);

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

  const selectedProviderId = providerId && providerId > 0 ? providerId : null;
  const selectedProvider = useMemo(
    () => providers.find((item) => item.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const handleBack = useCallback(() => setProviderId(null), [setProviderId]);

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
        cell: () => (
          <div className="text-right text-muted-foreground">
            <ChevronRight className="ml-auto h-4 w-4" />
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
      },
    ],
    [i18n.language, keyProviderStatusMap, t],
  );

  if (selectedProviderId) {
    return (
      <KeyProviderDetailPage
        providerId={selectedProviderId}
        provider={selectedProvider}
        onBack={handleBack}
      />
    );
  }

  return (
    <div>
      <Header title={t("admin.key-providers.title")} description={t("admin.key-providers.desc")} />

      <div className="space-y-4 p-4 md:space-y-6 md:p-8">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("admin.key-providers.btn.create")}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={providers}
          emptyText={t("admin.key-providers.table-empty")}
          getRowId={(row) => String(row.id)}
          loading={isLoading}
          onRowClick={(row) => setProviderId(row.id)}
          showPagination={false}
          tableClassName="min-w-[900px]"
        />
      </div>

      <CreateKeyProviderDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
