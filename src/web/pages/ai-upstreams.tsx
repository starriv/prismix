import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
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
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { ScrollArea } from "@/web/components/ui/scroll-area";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Skeleton } from "@/web/components/ui/skeleton";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
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
    <Badge variant={config.variant} className="gap-1">
      <config.Icon className="h-3 w-3" />
      {label}
    </Badge>
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
  const { t } = useTranslation();
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
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : sortedUpstreams.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("ai-upstreams.empty")}
              </p>
            ) : (
              <ScrollArea>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("ai-upstreams.th.provider")}</TableHead>
                      <TableHead>{t("ai-upstreams.th.upstream")}</TableHead>
                      <TableHead>{t("ai-upstreams.th.kind")}</TableHead>
                      <TableHead>{t("ai-upstreams.th.status")}</TableHead>
                      <TableHead className="text-right">{t("ai-upstreams.th.keys")}</TableHead>
                      <TableHead className="text-right">{t("ai-upstreams.th.requests")}</TableHead>
                      <TableHead className="text-right">
                        {t("ai-upstreams.th.error-rate")}
                      </TableHead>
                      <TableHead className="text-right">{t("ai-upstreams.th.latency")}</TableHead>
                      <TableHead>{t("ai-upstreams.th.last-seen")}</TableHead>
                      <TableHead>{t("ai-upstreams.th.enabled")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUpstreams.map((upstream) => (
                      <TableRow key={upstream.id}>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {upstream.providerName ?? upstream.providerId ?? "-"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {upstream.providerId ?? "-"}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[340px]">
                          <div className="text-sm font-medium">{upstream.name}</div>
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {upstream.baseUrl}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{upstream.kind}</Badge>
                        </TableCell>
                        <TableCell>
                          <HealthBadge
                            status={upstream.healthStatus}
                            label={t(`ai-upstreams.health.${upstream.healthStatus}`)}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {upstream.enabledKeys}/{upstream.totalKeys}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {upstream.requests24h.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {removeTailingZero(safeMultipliedBy(upstream.errorRate24h, 100), 1)}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {upstream.avgLatencyMs24h > 0 ? `${upstream.avgLatencyMs24h}ms` : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {upstream.lastSeenAt
                            ? formatDistanceToNow(new Date(upstream.lastSeenAt), {
                                addSuffix: true,
                              })
                            : t("ai-upstreams.never")}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-center">
                            <Switch
                              checked={upstream.enabled}
                              disabled={updateUpstream.isPending}
                              onCheckedChange={(enabled) =>
                                void handleToggleUpstream(upstream, enabled)
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setSelected(upstream)}>
                            {t("ai-upstreams.actions.details")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
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
                      {recentLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ) : recent.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          {t("ai-upstreams.detail.recent-empty")}
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("ai-upstreams.detail.model")}</TableHead>
                              <TableHead className="text-right">
                                {t("ai-upstreams.detail.tokens")}
                              </TableHead>
                              <TableHead className="text-right">
                                {t("ai-upstreams.detail.latency")}
                              </TableHead>
                              <TableHead>{t("ai-upstreams.detail.status")}</TableHead>
                              <TableHead>{t("ai-upstreams.detail.time")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recent.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className="font-mono text-xs">
                                  {row.modelId ?? "-"}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  {formatTokens(row.totalTokens)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  {row.latencyMs != null ? `${row.latencyMs}ms` : "-"}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge code={row.statusCode} error={row.error} />
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatDistanceToNow(new Date(row.createdAt), {
                                    addSuffix: true,
                                  })}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
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
