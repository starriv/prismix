import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { format } from "date-fns";
import { sumBy } from "lodash-es";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { CardContent, CardDescription, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Card } from "@/web/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/web/components/ui/chart";
import { formatTokens } from "@/web/pages/ai-usage/helpers";

// ── Config ─────────────────────────────────────────────

const barChartConfig = {
  views: { label: "Views" },
  requests: { label: "Requests", color: "var(--chart-1)" },
  tokens: { label: "Tokens", color: "var(--chart-2)" },
} satisfies ChartConfig;

type BarMetric = "requests" | "tokens";

// ── Component ──────────────────────────────────────────

export default function UserVolumeChart({
  data,
}: {
  data: { date: string; requests: number; totalTokens: number; estimatedCost: number }[];
}) {
  const { t } = useTranslation();
  const [activeMetric, setActiveMetric] = useState<BarMetric>("requests");

  const chartData = useMemo(
    () =>
      data.map((row) => ({
        date: row.date,
        requests: row.requests,
        tokens: Number(row.totalTokens),
      })),
    [data],
  );

  const totals = useMemo(
    () => ({
      requests: sumBy(data, "requests"),
      tokens: sumBy(data, (d) => Number(d.totalTokens)),
    }),
    [data],
  );

  const handleToggle = useCallback((metric: BarMetric) => () => setActiveMetric(metric), []);

  return (
    <Card className="py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
          <CardTitle className="text-sm">{t("user.dash.volume-title")}</CardTitle>
          <CardDescription className="text-xs">{t("user.dash.volume-desc")}</CardDescription>
        </div>
        <div className="flex">
          {(["requests", "tokens"] as const).map((key) => (
            <button
              key={key}
              type="button"
              data-active={activeMetric === key}
              className="relative flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-t-0 sm:border-l sm:px-8 sm:py-6"
              onClick={handleToggle(key)}
            >
              <span className="text-xs text-muted-foreground">{t(`user.dash.volume-${key}`)}</span>
              <span className="text-lg font-bold leading-none tabular-nums sm:text-3xl">
                {formatTokens(totals[key])}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={barChartConfig} className="aspect-auto h-[250px] w-full">
          <BarChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value: string) => {
                const dateStr = value.includes(" ") ? value.split(" ")[0] : value;
                return format(new Date(dateStr), "MM/dd");
              }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  nameKey="views"
                  labelFormatter={(value) => {
                    const str = String(value);
                    const dateStr = str.includes(" ") ? str.split(" ")[0] : str;
                    return format(new Date(dateStr), "yyyy-MM-dd");
                  }}
                />
              }
            />
            <Bar dataKey={activeMetric} fill={`var(--color-${activeMetric})`} maxBarSize={56} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
