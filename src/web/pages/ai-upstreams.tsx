import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { format, formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { orderBy, sumBy } from "lodash-es";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Network,
  PauseCircle,
  Pencil,
  Plus,
  Server,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { z } from "zod";

import { removeTailingZero, safeMultipliedBy } from "@/shared/number";
import {
  useAiUpstreamDetail,
  useAiUpstreamHourly,
  useAiUpstreamRecent,
  useAiUpstreamsOverview,
  useCreateAiUpstream,
  useDeleteAiUpstream,
  useUpdateAiUpstream,
} from "@/web/api/hooks";
import type {
  AiUpstreamDetailAssignment,
  AiUpstreamHourlyRow,
  AiUpstreamOverviewItem,
} from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { StatCard } from "@/web/components/dashboard/stat-card";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/web/components/ui/chart";
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
import { Skeleton } from "@/web/components/ui/skeleton";
import { Switch } from "@/web/components/ui/switch";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";
import { cn } from "@/web/shared/utils";

// ── Health helpers ──────────────────────────────────────────────────

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

function healthDotColor(status: AiUpstreamOverviewItem["healthStatus"]) {
  return match(status)
    .with("healthy", () => "bg-green-500")
    .with("degraded", () => "bg-red-500")
    .with("idle", () => "bg-yellow-500")
    .with("no-key", () => "bg-orange-500")
    .with("disabled", () => "bg-muted-foreground/40")
    .exhaustive();
}

function formatRelativeTimeLabel(
  value: Date | number | string | null | undefined,
  language: string,
  fallback: string,
) {
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: language === "zh" ? zhCN : enUS,
  });
}

const SEVERITY_RANK: Record<AiUpstreamOverviewItem["healthStatus"], number> = {
  degraded: 0,
  "no-key": 1,
  idle: 2,
  healthy: 3,
  disabled: 4,
};

// ── Page ────────────────────────────────────────────────────────────

export default function AiUpstreamsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useAiUpstreamsOverview(24, 10_000);
  const updateUpstream = useUpdateAiUpstream();
  const [selectedId, setSelectedId] = useQueryState("upstreamId", parseAsInteger);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiUpstreamOverviewItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiUpstreamOverviewItem | null>(null);

  const sortedUpstreams = useMemo(
    () =>
      orderBy(
        data?.upstreams ?? [],
        [(u) => SEVERITY_RANK[u.healthStatus], (u) => u.requests24h],
        ["asc", "desc"],
      ),
    [data?.upstreams],
  );

  const selectedUpstream = useMemo(
    () => sortedUpstreams.find((u) => u.id === selectedId) ?? null,
    [sortedUpstreams, selectedId],
  );

  const handleSelect = useCallback(
    (u: AiUpstreamOverviewItem) => void setSelectedId(u.id),
    [setSelectedId],
  );

  const handleBack = useCallback(() => void setSelectedId(null), [setSelectedId]);

  const handleToggleUpstream = useCallback(
    async (upstream: AiUpstreamOverviewItem, enabled: boolean) => {
      try {
        await updateUpstream.mutateAsync({ id: upstream.id, enabled });
        toast.success(t("ai-upstreams.toast.updated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("ai-upstreams.toast.update-error"));
      }
    },
    [t, updateUpstream],
  );

  const updatingUpstreamId = updateUpstream.isPending
    ? (updateUpstream.variables?.id ?? null)
    : null;

  return (
    <div>
      <Header title={t("ai-upstreams.title")} description={t("ai-upstreams.desc")} />

      <div className="space-y-6 p-4 md:p-8">
        {selectedUpstream ? (
          <UpstreamDetail
            upstream={selectedUpstream}
            onBack={handleBack}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
          />
        ) : (
          <>
            <div className="flex items-center justify-end">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("ai-upstreams.btn.new")}
              </Button>
            </div>

            {/* Stats */}
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
                value={String(data?.totals.degradedUpstreams30m ?? 0)}
                subtitle={t("ai-upstreams.stats.degraded-subtitle")}
                icon={ShieldAlert}
              />
            </div>

            {/* Card Grid */}
            <UpstreamGrid
              upstreams={sortedUpstreams}
              loading={isLoading}
              onSelect={handleSelect}
              onToggle={handleToggleUpstream}
              updatingUpstreamId={updatingUpstreamId}
            />
          </>
        )}

        {/* Dialogs */}
        <UpstreamFormDialog
          open={createOpen || !!editTarget}
          onOpenChange={(open) => {
            if (!open) {
              setCreateOpen(false);
              setEditTarget(null);
            }
          }}
          editTarget={editTarget}
        />
        <DeleteUpstreamDialog
          target={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
            if (selectedId && deleteTarget?.id === selectedId) {
              void setSelectedId(null);
            }
          }}
        />
      </div>
    </div>
  );
}

// ── Card Grid ──────────────────────────────────────────────────────

function UpstreamGrid({
  upstreams,
  loading,
  onSelect,
  onToggle,
  updatingUpstreamId,
}: {
  upstreams: AiUpstreamOverviewItem[];
  loading: boolean;
  onSelect: (u: AiUpstreamOverviewItem) => void;
  onToggle: (u: AiUpstreamOverviewItem, enabled: boolean) => void;
  updatingUpstreamId: number | null;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-3 w-64" />
          </Card>
        ))}
      </div>
    );
  }

  if (upstreams.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Network className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("ai-upstreams.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {upstreams.map((upstream) => (
        <UpstreamCard
          key={upstream.id}
          upstream={upstream}
          onOpen={() => onSelect(upstream)}
          onToggle={(enabled) => onToggle(upstream, enabled)}
          updating={updatingUpstreamId === upstream.id}
        />
      ))}
    </div>
  );
}

function UpstreamCardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}

// ── Upstream Card ──────────────────────────────────────────────────

function UpstreamCard({
  upstream,
  onOpen,
  onToggle,
  updating,
}: {
  upstream: AiUpstreamOverviewItem;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  updating: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lastSeenLabel = formatRelativeTimeLabel(
    upstream.lastSeenAt,
    i18n.language,
    t("ai-upstreams.never"),
  );
  const errorRateLabel = `${removeTailingZero(safeMultipliedBy(upstream.errorRate24h, 100), 1)}%`;

  return (
    <Card
      className={cn(
        "h-full transition-[box-shadow,border-color,opacity] hover:shadow-md hover:border-primary/30",
        !upstream.enabled && "opacity-60",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Network aria-hidden="true" className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{upstream.name}</h3>
          </div>
          <div
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              healthDotColor(upstream.healthStatus),
            )}
            title={t(`ai-upstreams.health.${upstream.healthStatus}`)}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-10">
          <Badge variant="outline" className="text-xs">
            {upstream.kind}
          </Badge>
          <HealthBadge
            status={upstream.healthStatus}
            label={t(`ai-upstreams.health.${upstream.healthStatus}`)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <p className="truncate font-mono text-xs text-muted-foreground">{upstream.baseUrl}</p>
        <div className="grid grid-cols-2 gap-3">
          <UpstreamCardMetric
            label={t("ai-upstreams.th.assignments")}
            value={String(upstream.assignmentCount)}
          />
          <UpstreamCardMetric
            label={t("ai-upstreams.th.keys")}
            value={`${upstream.enabledKeys}/${upstream.totalKeys}`}
          />
          <UpstreamCardMetric
            label={t("ai-upstreams.th.requests")}
            value={upstream.requests24h.toLocaleString(i18n.language)}
          />
          <UpstreamCardMetric label={t("ai-upstreams.th.error-rate")} value={errorRateLabel} />
          <div className="col-span-2">
            <UpstreamCardMetric label={t("ai-upstreams.th.last-seen")} value={lastSeenLabel} />
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={upstream.enabled}
            disabled={updating}
            aria-label={t("ai-upstreams.th.enabled")}
            onCheckedChange={onToggle}
          />
          <span className="text-xs text-muted-foreground">{t("ai-upstreams.th.enabled")}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpen}
          aria-label={t("ai-upstreams.card.open-upstream", { name: upstream.name })}
        >
          {t("ai-upstreams.actions.details")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function LoadErrorState({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 py-2">
      <p className="text-sm font-medium">
        {t("common.error.load-failed", { defaultValue: "Failed to load details." })}
      </p>
      <p className="text-xs text-muted-foreground">
        {error instanceof Error
          ? error.message
          : t("common.valid.unknown-error", { defaultValue: "Unknown error" })}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
        {t("common.btn.retry", { defaultValue: "Retry" })}
      </Button>
    </div>
  );
}

// ── Detail View ────────────────────────────────────────────────────

function UpstreamDetail({
  upstream,
  onBack,
  onEdit,
  onDelete,
}: {
  upstream: AiUpstreamOverviewItem;
  onBack: () => void;
  onEdit: (u: AiUpstreamOverviewItem) => void;
  onDelete: (u: AiUpstreamOverviewItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const updateUpstream = useUpdateAiUpstream();
  const {
    data: detail,
    error: detailError,
    isError: detailIsError,
    isFetching: detailIsFetching,
    isLoading: detailIsLoading,
    refetch: refetchDetail,
  } = useAiUpstreamDetail(upstream.id);
  const { data: hourly = [] } = useAiUpstreamHourly(upstream.id, 24, 30_000);
  const { data: recent = [], isLoading: recentLoading } = useAiUpstreamRecent(
    upstream.id,
    10,
    10_000,
  );

  const handleToggle = useCallback(async () => {
    try {
      await updateUpstream.mutateAsync({ id: upstream.id, enabled: !upstream.enabled });
      toast.success(t("ai-upstreams.toast.updated"));
    } catch {
      toast.error(t("ai-upstreams.toast.update-error"));
    }
  }, [updateUpstream, upstream, t]);

  const lastSeenLabel = formatRelativeTimeLabel(
    upstream.lastSeenAt,
    i18n.language,
    t("ai-upstreams.never"),
  );

  // ── Assignment columns ──
  const assignmentColumns = useMemo<ColumnDef<AiUpstreamDetailAssignment>[]>(
    () => [
      {
        accessorKey: "providerName",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.providerName}</DataTableText>
        ),
        header: t("ai-upstreams.detail.provider-name"),
        meta: { headerClassName: "w-[36%]" },
      },
      {
        accessorKey: "priority",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.priority}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.priority"),
        meta: { headerClassName: "w-[18%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "weight",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.weight}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.weight"),
        meta: { headerClassName: "w-[18%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "default" : "outline"} className="text-xs">
            {row.original.enabled ? t("common.status.active") : t("common.status.disabled")}
          </Badge>
        ),
        header: t("ai-upstreams.th.enabled"),
        meta: { headerClassName: "w-[16%]" },
      },
    ],
    [t],
  );

  // ── Recent request columns ──
  const recentColumns = useMemo<ColumnDef<(typeof recent)[number]>[]>(
    () => [
      {
        accessorKey: "modelId",
        cell: ({ row }) => <DataTableText mono>{row.original.modelId ?? "-"}</DataTableText>,
        header: t("ai-upstreams.detail.model"),
        meta: { headerClassName: "w-[28%]" },
      },
      {
        accessorKey: "totalTokens",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {formatTokens(row.original.totalTokens)}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.tokens"),
        meta: { headerClassName: "w-[16%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "latencyMs",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.latencyMs != null ? `${row.original.latencyMs}ms` : "-"}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.latency"),
        meta: { headerClassName: "w-[16%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "statusCode",
        cell: ({ row }) => (
          <StatusBadge code={row.original.statusCode} error={row.original.error} />
        ),
        header: t("ai-upstreams.detail.status"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("ai-upstreams.detail.time"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        id: "actions",
        cell: ({ row }) =>
          row.original.requestId ? (
            <LocaleLink
              to={`/admin/ai-logs?requestId=${encodeURIComponent(row.original.requestId)}`}
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </LocaleLink>
          ) : null,
        meta: { headerClassName: "w-[10%]" },
      },
    ],
    [i18n.language, t],
  );

  return (
    <div className="space-y-5">
      {/* ── Info Card ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label={t("common.btn.back")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                <Network className="h-3.5 w-3.5 text-primary" />
              </div>
              <CardTitle className="text-base">{upstream.name}</CardTitle>
              <Badge variant="secondary" className="font-mono text-xs">
                {upstream.upstreamId}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={upstream.enabled}
                onCheckedChange={handleToggle}
                disabled={updateUpstream.isPending}
              />
              <Button variant="outline" size="sm" onClick={() => onEdit(upstream)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t("ai-upstreams.btn.edit")}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onDelete(upstream)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("ai-upstreams.btn.delete")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.base-url")}</span>
              <p className="font-mono text-xs break-all mt-0.5">{upstream.baseUrl}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.kind")}</span>
              <p className="mt-0.5">
                <Badge variant="outline" className="text-xs">
                  {upstream.kind}
                </Badge>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.health")}</span>
              <div className="mt-0.5">
                <HealthBadge
                  status={upstream.healthStatus}
                  label={t(`ai-upstreams.health.${upstream.healthStatus}`)}
                />
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.keys")}</span>
              <p className="mt-0.5 font-mono">
                {upstream.enabledKeys}/{upstream.totalKeys}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Metrics Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t("ai-upstreams.detail.metrics")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-5 text-sm">
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.requests-24h")}</span>
              <p className="text-lg font-bold mt-0.5">
                {upstream.requests24h.toLocaleString(i18n.language)}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.error-rate")}</span>
              <p className="text-lg font-bold mt-0.5">
                {removeTailingZero(safeMultipliedBy(upstream.errorRate24h, 100), 1)}%
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.tokens-24h")}</span>
              <p className="text-lg font-bold mt-0.5">{formatTokens(upstream.totalTokens24h)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.avg-latency")}</span>
              <p className="text-lg font-bold mt-0.5">
                {upstream.avgLatencyMs24h > 0 ? `${Math.round(upstream.avgLatencyMs24h)}ms` : "-"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("ai-upstreams.detail.last-seen")}</span>
              <p className="text-lg font-bold mt-0.5">{lastSeenLabel}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Health Trend Chart ── */}
      <UpstreamHealthChart data={hourly} />

      {/* ── Provider Assignments ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t("ai-upstreams.detail.assignments-title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {detailIsError && !detail ? (
            <LoadErrorState
              error={detailError}
              onRetry={() => void refetchDetail()}
              retrying={detailIsFetching}
            />
          ) : (
            <DataTable
              columns={assignmentColumns}
              data={detail?.assignments ?? []}
              emptyText={t("ai-upstreams.detail.assignments-empty")}
              getRowId={(row) => String(row.id)}
              loading={{ fetching: detailIsFetching, initial: detailIsLoading }}
              showPagination={false}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Recent Requests ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t("ai-upstreams.detail.recent-title")}</CardTitle>
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
    </div>
  );
}

// ── Health Trend Chart ──────────────────────────────────────────────

type HealthMetric = "requests" | "errors" | "avgLatencyMs";

function UpstreamHealthChart({ data }: { data: AiUpstreamHourlyRow[] }) {
  const { t } = useTranslation();
  const [activeMetric, setActiveMetric] = useState<HealthMetric>("requests");

  const chartConfig = useMemo(
    () =>
      ({
        requests: { label: t("ai-upstreams.detail.chart-requests"), color: "var(--chart-1)" },
        errors: { label: t("ai-upstreams.detail.chart-errors"), color: "var(--chart-5)" },
        avgLatencyMs: { label: t("ai-upstreams.detail.chart-latency"), color: "var(--chart-2)" },
      }) satisfies ChartConfig,
    [t],
  );

  const chartData = useMemo(
    () =>
      data.map((row) => {
        const hourDate = new Date(row.hour);
        const hasValidHour = !Number.isNaN(hourDate.getTime());

        return {
          ...row,
          errors: row.clientErrors + row.serverErrors,
          label: hasValidHour ? format(hourDate, "HH:mm") : "--:--",
          tooltipLabel: hasValidHour ? format(hourDate, "yyyy-MM-dd HH:mm") : row.hour,
        };
      }),
    [data],
  );

  const totals = useMemo(() => {
    const totalRequests = sumBy(data, "requests");

    return {
      requests: totalRequests,
      errors: sumBy(data, "clientErrors") + sumBy(data, "serverErrors"),
      avgLatencyMs:
        totalRequests > 0
          ? Math.round(
              data.reduce((total, row) => total + row.requests * row.avgLatencyMs, 0) /
                totalRequests,
            )
          : 0,
    };
  }, [data]);

  const handleToggle = useCallback(
    (metric: HealthMetric) => () => {
      setActiveMetric(metric);
    },
    [],
  );

  const formatTotal = useCallback(
    (metric: HealthMetric, value: number) =>
      match(metric)
        .with("avgLatencyMs", () => (value > 0 ? `${value}ms` : "-"))
        .otherwise(() => value.toLocaleString()),
    [],
  );

  return (
    <Card className="py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
          <CardTitle className="text-sm">{t("ai-upstreams.detail.health-trend-title")}</CardTitle>
          <CardDescription className="text-xs">
            {t("ai-upstreams.detail.health-trend-desc")}
          </CardDescription>
        </div>
        <div className="flex">
          {(
            [
              ["requests", t("ai-upstreams.detail.chart-requests")],
              ["errors", t("ai-upstreams.detail.chart-errors")],
              ["avgLatencyMs", t("ai-upstreams.detail.chart-latency")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-active={activeMetric === key}
              className="relative flex flex-1 flex-col justify-center gap-1 border-t px-4 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-t-0 sm:border-l sm:px-6 sm:py-6"
              onClick={handleToggle(key)}
            >
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-lg font-bold leading-none tabular-nums sm:text-3xl">
                {formatTotal(key, totals[key])}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
            <defs>
              <linearGradient id="fill-upstream-active" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${activeMetric})`} stopOpacity={0.35} />
                <stop offset="95%" stopColor={`var(--color-${activeMetric})`} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_value, payload) => {
                    const item = payload[0]?.payload as { tooltipLabel?: string } | undefined;
                    return item?.tooltipLabel ?? "";
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey={activeMetric}
              stroke={`var(--color-${activeMetric})`}
              fill="url(#fill-upstream-active)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ── Create / Edit Dialog ────────────────────────────────────────────

const createUpstreamSchema = z.object({
  name: z.string().min(1, "common.valid.required").max(100),
  baseUrl: z.string().url("common.valid.invalid-url").max(500),
  modelsEndpoint: z.string().url("common.valid.invalid-url").max(500).or(z.literal("")).optional(),
  enabled: z.boolean(),
});

type CreateUpstreamForm = z.infer<typeof createUpstreamSchema>;

function UpstreamFormDialog({
  open,
  onOpenChange,
  editTarget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: AiUpstreamOverviewItem | null;
}) {
  const { t } = useTranslation();
  const createUpstream = useCreateAiUpstream();
  const updateUpstream = useUpdateAiUpstream();
  const isEdit = !!editTarget;

  const form = useForm<CreateUpstreamForm>({
    resolver: zodResolver(createUpstreamSchema),
    defaultValues: { name: "", baseUrl: "", modelsEndpoint: "", enabled: true },
  });

  useEffect(() => {
    if (editTarget) {
      form.reset({
        name: editTarget.name,
        baseUrl: editTarget.baseUrl,
        modelsEndpoint: editTarget.modelsEndpoint ?? "",
        enabled: editTarget.enabled,
      });
    } else {
      form.reset({ name: "", baseUrl: "", modelsEndpoint: "", enabled: true });
    }
  }, [editTarget, form]);

  const onSubmit = useCallback(
    async (values: CreateUpstreamForm) => {
      try {
        if (isEdit) {
          await updateUpstream.mutateAsync({
            id: editTarget.id,
            name: values.name,
            baseUrl: values.baseUrl,
            modelsEndpoint: values.modelsEndpoint || null,
            enabled: values.enabled,
          });
          toast.success(t("ai-upstreams.toast.updated"));
        } else {
          await createUpstream.mutateAsync({
            ...values,
            modelsEndpoint: values.modelsEndpoint || null,
          });
          toast.success(t("ai-upstreams.toast.created"));
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t(isEdit ? "ai-upstreams.toast.update-error" : "ai-upstreams.toast.create-error"),
        );
      }
    },
    [isEdit, editTarget, createUpstream, updateUpstream, onOpenChange, t],
  );

  const isPending = createUpstream.isPending || updateUpstream.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? "ai-upstreams.dialog.edit-title" : "ai-upstreams.dialog.create-title")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-upstreams.form.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("ai-upstreams.form.name-ph")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-upstreams.form.base-url")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("ai-upstreams.form.base-url-ph")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="modelsEndpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-upstreams.form.models-endpoint")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("ai-upstreams.form.models-endpoint-ph")} />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">
                      {t("ai-upstreams.form.models-endpoint-desc")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormLabel>{t("ai-upstreams.form.enabled")}</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t(isEdit ? "ai-upstreams.btn.save" : "ai-upstreams.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirmation ─────────────────────────────────────────────

function DeleteUpstreamDialog({
  target,
  onClose,
}: {
  target: AiUpstreamOverviewItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteUpstream = useDeleteAiUpstream();

  const handleDelete = useCallback(async () => {
    if (!target) return;
    try {
      await deleteUpstream.mutateAsync(target.id);
      toast.success(t("ai-upstreams.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-upstreams.toast.delete-error"));
    }
  }, [target, deleteUpstream, onClose, t]);

  return (
    <Dialog open={!!target} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ai-upstreams.dialog.delete-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("ai-upstreams.dialog.delete-body")}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteUpstream.isPending}>
            {deleteUpstream.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("ai-upstreams.btn.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
