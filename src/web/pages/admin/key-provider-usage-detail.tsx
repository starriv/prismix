import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, BarChart3, DollarSign, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { removeTailingZero } from "@/shared/number";
import { useKeyProviderDetail } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/web/components/ui/chart";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { cn } from "@/web/shared/utils";

import { TransactionList } from "./key-providers/transaction-list";

const chartConfig = {
  upstreamCost: { label: "Upstream Cost", color: "var(--chart-1)" },
  revenueShare: { label: "Revenue Share", color: "var(--chart-2)" },
} satisfies ChartConfig;

export default function KeyProviderUsageDetailPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const providerId = Number(searchParams.get("id"));
  const validId = Number.isInteger(providerId) && providerId > 0 ? providerId : null;
  const { data: provider, isLoading, isError, error } = useKeyProviderDetail(validId);

  const chartData = useMemo(
    () =>
      (provider?.keySummaries ?? []).map((row) => ({
        keyId: row.keyId,
        name: row.keyName,
        shortName: row.keyName.length > 18 ? `${row.keyName.slice(0, 16)}...` : row.keyName,
        upstreamCost: Number(row.upstreamCost),
        revenueShare: Number(row.revenueShare),
      })),
    [provider?.keySummaries],
  );

  return (
    <div>
      <Header
        title={
          provider
            ? t("admin.key-providers.report.title", {
                defaultValue: "{{name}} Report",
                name: provider.name,
              })
            : t("admin.key-providers.report.title-fallback", {
                defaultValue: "Key Provider Report",
              })
        }
        description={
          provider
            ? t("admin.key-providers.report.desc", {
                defaultValue: "Detailed reconciliation and key-level profitability.",
              })
            : undefined
        }
      />

      <div className="p-4 md:p-8 space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <LocaleLink to="/admin/key-providers">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            {t("admin.key-providers.report.back", { defaultValue: "Back to key providers" })}
          </LocaleLink>
        </Button>

        {!validId ? (
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground">
              {t("admin.key-providers.report.invalid-id", {
                defaultValue: "Missing or invalid provider ID.",
              })}
            </CardContent>
          </Card>
        ) : isLoading ? (
          <ReportSkeleton />
        ) : isError || !provider ? (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-medium">
                {t("common.error.load-failed", { defaultValue: "Failed to load details." })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof Error ? error.message : t("common.valid.unknown-error")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
              <StatCard
                icon={Wallet}
                label={t("admin.key-providers.detail.cost", { defaultValue: "Upstream cost" })}
                value={`$${removeTailingZero(provider.totals.upstreamCost)}`}
              />
              <StatCard
                icon={DollarSign}
                label={t("admin.key-providers.detail.profit", { defaultValue: "Revenue share" })}
                value={`$${removeTailingZero(provider.totals.revenueShare)}`}
              />
              <StatCard
                icon={BarChart3}
                label={t("admin.key-providers.detail.requests", { defaultValue: "Requests" })}
                value={Intl.NumberFormat().format(provider.totals.requests)}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {t("admin.key-providers.report.chart-title", {
                    defaultValue: "Cost vs revenue share by key",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <p className="py-12 text-center text-xs text-muted-foreground">
                    {t("admin.key-providers.detail.no-keys", {
                      defaultValue: "No keys assigned to this provider.",
                    })}
                  </p>
                ) : (
                  <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
                    <BarChart accessibilityLayer data={chartData} margin={{ left: 8, right: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="shortName" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `$${removeTailingZero(v, 4)}`}
                        width={72}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_, payload) =>
                              (payload[0]?.payload as { name?: string } | undefined)?.name ?? ""
                            }
                          />
                        }
                      />
                      <Bar dataKey="upstreamCost" fill="var(--color-upstreamCost)" radius={4} />
                      <Bar dataKey="revenueShare" fill="var(--color-revenueShare)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {t("admin.key-providers.detail.by-key", { defaultValue: "By key" })}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                {provider.keySummaries.length === 0 ? (
                  <p className="px-6 text-sm text-muted-foreground">
                    {t("admin.key-providers.detail.no-keys", {
                      defaultValue: "No keys assigned to this provider.",
                    })}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.th.name")}</TableHead>
                          <TableHead>
                            {t("admin.key-providers.detail.cost", {
                              defaultValue: "Upstream cost",
                            })}
                          </TableHead>
                          <TableHead>
                            {t("admin.key-providers.detail.profit", {
                              defaultValue: "Revenue share",
                            })}
                          </TableHead>
                          <TableHead>
                            {t("admin.key-providers.detail.requests", {
                              defaultValue: "Requests",
                            })}
                          </TableHead>
                          <TableHead>{t("common.th.status", { defaultValue: "Status" })}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {provider.keySummaries.map((row) => (
                          <TableRow key={row.keyId}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="font-medium">{row.keyName}</div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  {row.keyPrefix}
                                </div>
                                {row.lastUsedAt && (
                                  <div className="text-xs text-muted-foreground">
                                    {t("admin.key-providers.detail.last-used", {
                                      defaultValue: "Last used {{time}}",
                                      time: formatDistanceToNow(new Date(row.lastUsedAt), {
                                        addSuffix: true,
                                      }),
                                    })}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              ${removeTailingZero(row.upstreamCost)}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              ${removeTailingZero(row.revenueShare)}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {Intl.NumberFormat().format(row.requests)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full border px-2 py-0.5 text-xs",
                                  row.enabled
                                    ? "border-green-500/30 bg-green-500/10 text-green-600"
                                    : "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
                                )}
                              >
                                {row.enabled
                                  ? t("common.status.active")
                                  : t("common.status.suspended")}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <TransactionList
              providerId={provider.id}
              keyLabels={Object.fromEntries(
                provider.keySummaries.map((row) => [row.keyId, row.keyName]),
              )}
              previewCount={50}
              defaultExpanded
              paginated
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
          <div className="rounded-md border bg-muted/40 p-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-[360px] w-full" />
      <Skeleton className="h-[320px] w-full" />
    </div>
  );
}
