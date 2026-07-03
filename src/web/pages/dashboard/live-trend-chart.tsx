import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { format } from "date-fns";
import { meanBy, sumBy } from "lodash-es";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import type { AiLiveTrendRow } from "@/web/api/schemas";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/web/components/ui/chart";
import { Skeleton } from "@/web/components/ui/skeleton";
import { cn } from "@/web/shared/utils";

type TrendMetric = "rpm" | "tpm" | "throughput";

interface LiveTrendChartProps {
  data: AiLiveTrendRow[];
  loading?: boolean;
  error?: boolean;
}

export default function LiveTrendChart({
  data,
  loading = false,
  error = false,
}: LiveTrendChartProps) {
  const { t } = useTranslation();
  const [activeMetric, setActiveMetric] = useState<TrendMetric>("rpm");
  const chartConfig = useMemo(
    () =>
      ({
        rpm: { label: t("ai-logs.stats.trend-rpm"), color: "var(--chart-1)" },
        tpm: { label: t("ai-logs.stats.trend-tpm"), color: "var(--chart-2)" },
        throughput: { label: t("ai-logs.stats.trend-throughput"), color: "var(--chart-4)" },
      }) satisfies ChartConfig,
    [t],
  );

  const totals = useMemo(
    () => ({
      rpm: sumBy(data, "rpm"),
      tpm: sumBy(data, "tpm"),
      throughput: data.length > 0 ? Math.round(meanBy(data, "throughput")) : 0,
    }),
    [data],
  );

  const chartData = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        label: format(new Date(row.ts), "HH:mm"),
      })),
    [data],
  );

  const handleToggle = useCallback(
    (metric: TrendMetric) => () => {
      setActiveMetric(metric);
    },
    [],
  );

  const formatTotal = (metric: TrendMetric, value: number): string => {
    if (metric === "throughput") return value.toLocaleString();
    return value.toLocaleString();
  };

  return (
    <Card className="py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
          <CardTitle className="text-sm">{t("ai-logs.stats.live-trend-title")}</CardTitle>
          <CardDescription className="text-xs">
            {t("ai-logs.stats.live-trend-desc")}
          </CardDescription>
        </div>
        <div className="flex">
          {(
            [
              ["rpm", t("ai-logs.stats.trend-rpm")],
              ["tpm", t("ai-logs.stats.trend-tpm")],
              ["throughput", t("ai-logs.stats.trend-throughput")],
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
              <span
                className={cn(
                  "text-lg font-bold leading-none tabular-nums sm:text-3xl",
                  (loading || error) && "text-muted-foreground",
                )}
              >
                {loading || error ? "—" : formatTotal(key, totals[key])}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : error ? (
          <div className="flex h-[280px] w-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("dash.ai.data-unavailable")}</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
              <defs>
                <linearGradient id="fill-live-active" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${activeMetric})`} stopOpacity={0.35} />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${activeMetric})`}
                    stopOpacity={0.03}
                  />
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
                      const item = payload[0]?.payload as { ts?: string } | undefined;
                      return item?.ts ? format(new Date(item.ts), "yyyy-MM-dd HH:mm") : "";
                    }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey={activeMetric}
                stroke={`var(--color-${activeMetric})`}
                fill="url(#fill-live-active)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
