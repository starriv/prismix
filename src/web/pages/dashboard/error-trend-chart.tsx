import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { format } from "date-fns";
import { sumBy } from "lodash-es";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import type { AiErrorDaily } from "@/web/api/schemas";
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

type ErrorMetric = "totalErrors" | "clientErrors" | "serverErrors";

export default function ErrorTrendChart({ data }: { data: AiErrorDaily[] }) {
  const { t } = useTranslation();
  const [activeMetric, setActiveMetric] = useState<ErrorMetric>("totalErrors");
  const chartConfig = useMemo(
    () =>
      ({
        totalErrors: { label: t("dash.ai.error-total"), color: "var(--chart-1)" },
        clientErrors: { label: t("dash.ai.error-4xx"), color: "var(--chart-2)" },
        serverErrors: { label: t("dash.ai.error-5xx"), color: "var(--chart-5)" },
      }) satisfies ChartConfig,
    [t],
  );

  const totals = useMemo(
    () => ({
      totalErrors: sumBy(data, "totalErrors"),
      clientErrors: sumBy(data, "clientErrors"),
      serverErrors: sumBy(data, "serverErrors"),
    }),
    [data],
  );

  const chartData = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        label: format(new Date(row.date), "MM/dd"),
      })),
    [data],
  );

  const handleToggle = useCallback(
    (metric: ErrorMetric) => () => {
      setActiveMetric(metric);
    },
    [],
  );

  return (
    <Card className="py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
          <CardTitle className="text-sm">{t("dash.ai.error-trend-title")}</CardTitle>
          <CardDescription className="text-xs">{t("dash.ai.error-trend-desc")}</CardDescription>
        </div>
        <div className="flex">
          {(
            [
              ["totalErrors", t("dash.ai.error-total")],
              ["clientErrors", t("dash.ai.error-4xx")],
              ["serverErrors", t("dash.ai.error-5xx")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-active={activeMetric === key}
              className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-4 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-t-0 sm:border-l sm:px-6 sm:py-6"
              onClick={handleToggle(key)}
            >
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-lg font-bold leading-none tabular-nums sm:text-3xl">
                {totals[key].toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          <AreaChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
            <defs>
              <linearGradient id="fill-error-active" x1="0" y1="0" x2="0" y2="1">
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
                    const item = payload[0]?.payload as { date?: string } | undefined;
                    return item?.date ? format(new Date(item.date), "yyyy-MM-dd") : "";
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey={activeMetric}
              stroke={`var(--color-${activeMetric})`}
              fill="url(#fill-error-active)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
