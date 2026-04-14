import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { orderBy } from "lodash-es";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Server,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { match } from "ts-pattern";

import { removeTailingZero, safeMultipliedBy } from "@/shared/number";
import {
  useAiUpstreamRecent,
  useAiUpstreamsOverview,
  useUpdateAiProviderUpstream,
} from "@/web/api/hooks";
import type { AiUpstreamOverviewItem } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { StatCard } from "@/web/components/dashboard/stat-card";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";

function HealthBadge({
  status,
  label,
}: {
  status: AiUpstreamOverviewItem["healthStatus"];
  label: string;
}) {
  const config = match(status)
    .with("healthy", () => ({
      variant: "default" as const,
      Icon: CheckCircle2,
    }))
    .with("degraded", () => ({
      variant: "destructive" as const,
      Icon: ShieldAlert,
    }))
    .with("idle", () => ({
      variant: "secondary" as const,
      Icon: PauseCircle,
    }))
    .with("no-key", () => ({
      variant: "outline" as const,
      Icon: AlertTriangle,
    }))
    .with("disabled", () => ({
      variant: "outline" as const,
      Icon: PauseCircle,
    }))
    .exhaustive();

  return (
    <DataTableBadge variant={config.variant} className="gap-1">
      <config.Icon className="h-3 w-3" />
      {label}
    </DataTableBadge>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AiUpstreamOverviewItem["healthStatus"], number> = {
  degraded: 0,
  "no-key": 1,
  idle: 2,
  healthy: 3,
  disabled: 4,
};

export default function AiUpstreamsPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useAiUpstreamsOverview(24, 10_000);
  const updateUpstream = useUpdateAiProviderUpstream();
  const [selected, setSelected] = useState<AiUpstreamOverviewItem | null>(null);
  const { data: recent = [], isLoading: recentLoading } = useAiUpstreamRecent(
    selected?.id ?? null,
    10,
    10_000,
  );

  const sortedUpstreams = useMemo(
    () =>
      orderBy(
        data?.upstreams ?? [],
        [(u) => SEVERITY_RANK[u.healthStatus], (u) => u.requests24h],
        ["asc", "desc"],
      ),
    [data?.upstreams],
  );

  const handleToggleUpstream = useCallback(
    async (upstream: AiUpstreamOverviewItem, enabled: boolean) => {
      try {
        await updateUpstream.mutateAsync({
          providerId: upstream.providerDbId,
          id: upstream.id,
          enabled,
        });
        toast.success(t("ai-providers.toast.upstream-updated"));
        if (selected?.id === upstream.id) {
          setSelected({
            ...selected,
            enabled,
            healthStatus: enabled ? selected.healthStatus : "disabled",
          });
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("ai-providers.toast.upstream-update-error"),
        );
      }
    },
    [updateUpstream, selected, t],
  );
  const upstreamColumns = useMemo<ColumnDef<AiUpstreamOverviewItem>[]>(
    () => [
      {
        accessorKey: "providerName",
        cell: ({ row }) => (
          <div>
            <DataTableText className="font-medium">
              {row.original.providerName ?? row.original.providerId ?? "-"}
            </DataTableText>
            <DataTableText muted>{row.original.providerId ?? "-"}</DataTableText>
          </div>
        ),
        header: t("ai-upstreams.th.provider"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <div className="max-w-[340px]">
            <DataTableText className="font-medium">{row.original.name}</DataTableText>
            <DataTableText className="truncate" mono muted>
              {row.original.baseUrl}
            </DataTableText>
          </div>
        ),
        header: t("ai-upstreams.th.upstream"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "kind",
        cell: ({ row }) => <DataTableBadge variant="outline">{row.original.kind}</DataTableBadge>,
        header: t("ai-upstreams.th.kind"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "healthStatus",
        cell: ({ row }) => (
          <HealthBadge
            status={row.original.healthStatus}
            label={t(`ai-upstreams.health.${row.original.healthStatus}`)}
          />
        ),
        header: t("ai-upstreams.th.status"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "enabledKeys",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.enabledKeys}/{row.original.totalKeys}
          </DataTableText>
        ),
        header: t("ai-upstreams.th.keys"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "requests24h",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.requests24h.toLocaleString(i18n.language)}
          </DataTableText>
        ),
        header: t("ai-upstreams.th.requests"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "errorRate24h",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {removeTailingZero(safeMultipliedBy(row.original.errorRate24h, 100), 1)}%
          </DataTableText>
        ),
        header: t("ai-upstreams.th.error-rate"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "avgLatencyMs24h",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.avgLatencyMs24h > 0 ? `${row.original.avgLatencyMs24h}ms` : "-"}
          </DataTableText>
        ),
        header: t("ai-upstreams.th.latency"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "lastSeenAt",
        cell: ({ row }) =>
          row.original.lastSeenAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.lastSeenAt} />
          ) : (
            <DataTableText muted>{t("ai-upstreams.never")}</DataTableText>
          ),
        header: t("ai-upstreams.th.last-seen"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Switch
              checked={row.original.enabled}
              disabled={updateUpstream.isPending}
              onCheckedChange={(enabled) => void handleToggleUpstream(row.original, enabled)}
            />
          </div>
        ),
        header: t("ai-upstreams.th.enabled"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-right">
            <Button variant="ghost" size="sm" onClick={() => setSelected(row.original)}>
              {t("ai-upstreams.actions.details")}
            </Button>
          </div>
        ),
        header: "",
        enableHiding: false,
        meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
      },
    ],
    [handleToggleUpstream, i18n.language, t, updateUpstream.isPending],
  );
  const recentColumns = useMemo<ColumnDef<(typeof recent)[number]>[]>(
    () => [
      {
        accessorKey: "modelId",
        cell: ({ row }) => <DataTableText mono>{row.original.modelId ?? "-"}</DataTableText>,
        header: t("ai-upstreams.detail.model"),
        meta: { headerClassName: "w-[32%]" },
      },
      {
        accessorKey: "totalTokens",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {formatTokens(row.original.totalTokens)}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.tokens"),
        meta: { headerClassName: "w-[18%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "latencyMs",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.latencyMs != null ? `${row.original.latencyMs}ms` : "-"}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.latency"),
        meta: { headerClassName: "w-[18%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "statusCode",
        cell: ({ row }) => (
          <StatusBadge code={row.original.statusCode} error={row.original.error} />
        ),
        header: t("ai-upstreams.detail.status"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("ai-upstreams.detail.time"),
        meta: { headerClassName: "w-[16%]" },
      },
    ],
    [i18n.language, t],
  );

  return (
    <div>
      <Header title={t("ai-upstreams.title")} description={t("ai-upstreams.desc")} />

      <div className="space-y-6 p-4 md:p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title={t("ai-upstreams.stats.total")}
            value={String(data?.totals.totalUpstreams ?? 0)}
            subtitle={t("ai-upstreams.stats.total-subtitle")}
            icon={Server}
          />
          <StatCard
            title={t("ai-upstreams.stats.enabled")}
            value={String(data?.totals.enabledUpstreams ?? 0)}
            subtitle={t("ai-upstreams.stats.enabled-subtitle")}
            icon={CheckCircle2}
          />
          <StatCard
            title={t("ai-upstreams.stats.active")}
            value={String(data?.totals.activeUpstreams24h ?? 0)}
            subtitle={t("ai-upstreams.stats.active-subtitle")}
            icon={Activity}
          />
          <StatCard
            title={t("ai-upstreams.stats.degraded")}
            value={String(data?.totals.degradedUpstreams24h ?? 0)}
            subtitle={t("ai-upstreams.stats.degraded-subtitle")}
            icon={ShieldAlert}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("ai-upstreams.table.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={upstreamColumns}
              data={sortedUpstreams}
              emptyText={t("ai-upstreams.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              showPagination={false}
              tableClassName="min-w-[1320px]"
            />
          </CardContent>
        </Card>

        <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
          <SheetContent className="w-full sm:w-[520px]">
            <SheetHeader>
              <SheetTitle>{selected?.name ?? t("ai-upstreams.detail.title")}</SheetTitle>
            </SheetHeader>
            <SheetBody className="space-y-5">
              {selected && (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Card>
                      <CardContent className="space-y-2 pt-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.provider")}:{" "}
                          </span>
                          {selected.providerName ?? selected.providerId ?? "-"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.upstream-id")}:{" "}
                          </span>
                          <span className="font-mono">{selected.upstreamId}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.base-url")}:{" "}
                          </span>
                          <span className="font-mono break-all text-xs">{selected.baseUrl}</span>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="space-y-2 pt-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.health")}:{" "}
                          </span>
                          <HealthBadge
                            status={selected.healthStatus}
                            label={t(`ai-upstreams.health.${selected.healthStatus}`)}
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.enabled")}:{" "}
                          </span>
                          <Switch
                            checked={selected.enabled}
                            disabled={updateUpstream.isPending}
                            onCheckedChange={(enabled) =>
                              void handleToggleUpstream(selected, enabled)
                            }
                          />
                          {updateUpstream.isPending && (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.keys")}:{" "}
                          </span>
                          {selected.enabledKeys}/{selected.totalKeys}
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.tokens-24h")}:{" "}
                          </span>
                          {formatTokens(selected.totalTokens24h)}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">
                        {t("ai-upstreams.detail.recent-title")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        columns={recentColumns}
                        data={recent}
                        emptyText={t("ai-upstreams.detail.recent-empty")}
                        getRowId={(row) => String(row.id)}
                        loading={recentLoading}
                        showPagination={false}
                        tableClassName="min-w-[760px]"
                      />
                    </CardContent>
                  </Card>
                </>
              )}
            </SheetBody>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
