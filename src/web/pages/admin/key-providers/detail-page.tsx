import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, DollarSign, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import {
  useDeleteKeyProvider,
  useKeyProviderKeys,
  useKeyProviderRecent,
  useKeyProviderSummary,
  useUpdateKeyProvider,
} from "@/web/api/hooks";
import type { KeyProvider } from "@/web/api/key-provider-schemas";
import { Header } from "@/web/components/dashboard/header";
import { Pagination } from "@/web/components/dashboard/pagination";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import {
  DataTable,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Skeleton } from "@/web/components/ui/skeleton";
import { buildAiUsageRecentColumns } from "@/web/pages/ai-usage/columns";

import { KEY_PROVIDER_STATUS_COLORS } from "./constants";
import { TransactionList } from "./transaction-list";

const KEY_PAGE_SIZE = DEFAULT_PAGE_SIZE;
const RECENT_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export function KeyProviderDetailPage({
  providerId,
  provider,
  onBack,
}: {
  providerId: number;
  provider: KeyProvider | null;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [keyPage, setKeyPage] = useState(0);
  const [recentPage, setRecentPage] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryFetchError,
  } = useKeyProviderSummary(providerId);
  const {
    data: keys = [],
    isLoading: keysLoading,
    isError: keysError,
    error: keysFetchError,
  } = useKeyProviderKeys(providerId, {
    limit: KEY_PAGE_SIZE,
    offset: keyPage * KEY_PAGE_SIZE,
  });
  const {
    data: recent = [],
    isLoading: recentLoading,
    isError: recentError,
    error: recentFetchError,
  } = useKeyProviderRecent(providerId, {
    limit: RECENT_PAGE_SIZE,
    offset: recentPage * RECENT_PAGE_SIZE,
  });
  const updateMutation = useUpdateKeyProvider();
  const deleteMutation = useDeleteKeyProvider();

  useEffect(() => {
    setKeyPage(0);
    setRecentPage(0);
  }, [providerId]);

  const statusMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(KEY_PROVIDER_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`common.status.${key}`), className },
        ]),
      ),
    [t],
  );

  const keyColumns = useMemo<ColumnDef<(typeof keys)[number]>[]>(
    () => [
      {
        accessorKey: "keyName",
        cell: ({ row }) => (
          <div className="space-y-1">
            <DataTableText className="font-medium">{row.original.keyName}</DataTableText>
            <DataTableText mono muted>
              {row.original.keyPrefix}
            </DataTableText>
          </div>
        ),
        header: t("common.th.name"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "providerName",
        cell: ({ row }) => (
          <DataTableText>{row.original.providerName ?? t("common.status.unknown")}</DataTableText>
        ),
        header: t("admin.key-providers.detail.provider"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "upstreamName",
        cell: ({ row }) => <DataTableText muted>{row.original.upstreamName ?? "—"}</DataTableText>,
        header: t("admin.key-providers.detail.upstream"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "weight",
        cell: ({ row }) => <DataTableText numeric>{row.original.weight}</DataTableText>,
        header: t("admin.key-providers.detail.weight"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.rightHiddenOnMobile },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.enabled ? "active" : "suspended"}
            colorMap={statusMap}
          />
        ),
        header: t("common.th.status"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "lastUsedAt",
        cell: ({ row }) =>
          row.original.lastUsedAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.lastUsedAt} />
          ) : (
            <DataTableText muted>{t("admin.key-providers.detail.never-used")}</DataTableText>
          ),
        header: t("common.th.time"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "requests",
        cell: ({ row }) => (
          <DataTableText numeric>{Intl.NumberFormat().format(row.original.requests)}</DataTableText>
        ),
        header: t("admin.key-providers.detail.requests"),
        meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "revenueShare",
        cell: ({ row }) => (
          <DataTableText mono>{`$${removeTailingZero(row.original.revenueShare)}`}</DataTableText>
        ),
        header: t("admin.key-providers.detail.profit"),
        meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
      },
    ],
    [i18n.language, statusMap, t],
  );

  const recentColumns = useMemo(
    () => buildAiUsageRecentColumns({ language: i18n.language, t }),
    [i18n.language, t],
  );

  const keyLabels = useMemo(
    () => Object.fromEntries(keys.map((row) => [row.keyId, row.keyName])),
    [keys],
  );

  const handleToggleStatus = useCallback(async () => {
    if (!summary) return;
    const nextStatus = summary.status === "active" ? "suspended" : "active";
    try {
      await updateMutation.mutateAsync({ id: summary.id, status: nextStatus });
      toast.success(t("admin.key-providers.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.key-providers.toast.update-error"));
    }
  }, [summary, t, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!summary) return;
    try {
      await deleteMutation.mutateAsync(summary.id);
      toast.success(t("admin.key-providers.toast.deleted"));
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.key-providers.toast.delete-error"));
    }
  }, [deleteMutation, onBack, summary, t]);

  const title = summary?.name ?? provider?.name ?? t("admin.key-providers.report.title-fallback");
  const isLoading = summaryLoading;
  const hasError = summaryError || !summary;
  const errorMessage =
    summaryFetchError instanceof Error
      ? summaryFetchError.message
      : t("common.valid.unknown-error");
  const keysErrorMessage =
    keysFetchError instanceof Error ? keysFetchError.message : t("common.valid.unknown-error");
  const recentErrorMessage =
    recentFetchError instanceof Error ? recentFetchError.message : t("common.valid.unknown-error");

  return (
    <div>
      <Header title={title} description={t("admin.key-providers.report.desc")} />

      <div className="space-y-6 p-4 md:p-8">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          {t("admin.key-providers.report.back")}
        </Button>

        {isLoading ? (
          <DetailSkeleton />
        ) : hasError ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium">{t("common.error.load-failed")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{errorMessage}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label={t("admin.key-providers.detail.balance")}
                value={`$${removeTailingZero(summary.balance)}`}
                icon={Wallet}
              />
              <MetricCard
                label={t("admin.key-providers.detail.profit")}
                value={`$${removeTailingZero(summary.totals.revenueShare)}`}
                icon={DollarSign}
              />
              <MetricCard
                label={t("admin.key-providers.detail.requests")}
                value={Intl.NumberFormat().format(summary.totals.requests)}
              />
              <MetricCard
                label={t("admin.key-providers.detail.latest-call")}
                value={
                  summary.latestCallAt ? (
                    <DataTableRelativeTime language={i18n.language} value={summary.latestCallAt} />
                  ) : (
                    <DataTableText muted>
                      {t("admin.key-providers.detail.never-used")}
                    </DataTableText>
                  )
                }
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    {t("admin.key-providers.detail.key-list")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  {keysLoading ? (
                    <div className="space-y-2 px-6">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : keysError ? (
                    <div className="px-6 py-6 text-center">
                      <p className="text-sm font-medium">{t("common.error.load-failed")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{keysErrorMessage}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <DataTable
                        columns={keyColumns}
                        data={keys}
                        emptyText={t("admin.key-providers.detail.no-keys")}
                        getRowId={(row) => String(row.keyId)}
                        loading={false}
                        showPagination={false}
                        tableClassName="min-w-[1100px]"
                      />
                      <div className="px-6">
                        <Pagination
                          page={keyPage}
                          onPageChange={setKeyPage}
                          currentCount={keys.length}
                          pageSize={KEY_PAGE_SIZE}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {t("admin.key-providers.detail.info")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <InfoRow
                      label={t("admin.key-providers.form.share")}
                      value={`${summary.revenueSharePercent}%`}
                    />
                    <InfoRow
                      label={t("common.th.status")}
                      value={
                        <StatusBadge
                          status={summary.status}
                          colorMap={statusMap}
                          fallbackLabel={summary.status}
                        />
                      }
                    />
                    <InfoRow
                      label={t("admin.key-providers.th.keys")}
                      value={String(summary.keyCount ?? keys.length)}
                    />
                    {summary.email ? (
                      <InfoRow label={t("admin.key-providers.form.email")} value={summary.email} />
                    ) : null}
                    {summary.contactInfo ? (
                      <InfoRow
                        label={t("admin.key-providers.form.contact")}
                        value={summary.contactInfo}
                      />
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t("common.th.actions")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={handleToggleStatus}
                      disabled={updateMutation.isPending}
                    >
                      {summary.status === "active"
                        ? t("common.status.suspended")
                        : t("common.status.active")}
                    </Button>
                    <Button
                      className="w-full"
                      variant="destructive"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {t("common.btn.delete")}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("ai-usage.recent.title")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {recentLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : recentError ? (
                  <div className="py-6 text-center">
                    <p className="text-sm font-medium">{t("common.error.load-failed")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{recentErrorMessage}</p>
                  </div>
                ) : (
                  <>
                    <DataTable
                      columns={recentColumns}
                      data={recent}
                      emptyText={t("ai-usage.recent.empty")}
                      getRowId={(row) => String(row.id)}
                      loading={false}
                      showPagination={false}
                      tableClassName="min-w-[900px]"
                    />
                    <Pagination
                      page={recentPage}
                      onPageChange={setRecentPage}
                      currentCount={recent.length}
                      pageSize={RECENT_PAGE_SIZE}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            <TransactionList
              providerId={summary.id}
              keyLabels={keyLabels}
              paginated
              previewCount={DEFAULT_PAGE_SIZE}
            />

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("admin.key-providers.dialog.delete-title")}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.key-providers.dialog.delete-body", { name: summary.name })}
                  </p>
                </DialogBody>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    {t("common.btn.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                  >
                    {t("common.btn.delete")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Wallet;
  label: string;
  value: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        {Icon ? (
          <div className="rounded-lg border bg-muted/40 p-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right text-sm font-medium">{value}</div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[420px] w-full" />
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
      <Skeleton className="h-[280px] w-full" />
    </div>
  );
}
