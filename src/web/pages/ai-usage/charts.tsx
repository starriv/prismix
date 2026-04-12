import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { format } from "date-fns";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { removeTailingZero } from "@/shared/number";
import type { AiDailyUsage, AiUsageSummary } from "@/web/api/schemas";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/web/components/ui/chart";
import { formatTokens } from "@/web/pages/ai-usage/helpers";

// ── Helpers ──────────────────────────────────────────────────────────

function truncateModel(name: string): string {
  return name.length > 20 ? name.slice(0, 18) + "\u2026" : name;
}

// ── Daily Trend Chart ────────────────────────────────────────────────

const dailyChartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  cost: { label: "Cost ($)", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function DailyTrendChart({ data, height = 220 }: { data: AiDailyUsage[]; height?: number }) {
  const uid = useId().replace(/:/g, "");

  const chartData = useMemo(
    () =>
      data.map((row) => ({
        date: row.date,
        label: format(new Date(row.date), "MM/dd"),
        requests: row.requests,
        cost: row.estimatedCost,
      })),
    [data],
  );

  return (
    <div className="overflow-hidden">
      <ChartContainer
        config={dailyChartConfig}
        className={`aspect-auto w-full h-[${height}px]`}
        style={{ height }}
      >
        <AreaChart accessibilityLayer data={chartData}>
          <defs>
            <linearGradient id={`fillReq-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-requests)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-requests)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={`fillCost-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-cost)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-cost)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={40}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={65}
            tickFormatter={(v: number) => `$${removeTailingZero(v, 4)}`}
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
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="requests"
            stroke="var(--color-requests)"
            fill={`url(#fillReq-${uid})`}
            strokeWidth={2}
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="cost"
            stroke="var(--color-cost)"
            fill={`url(#fillCost-${uid})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

// ── Model Distribution Chart ─────────────────────────────────────────

export function ModelDistributionChart({
  summary,
  height = 220,
}: {
  summary: AiUsageSummary;
  height?: number;
}) {
  const { t } = useTranslation();

  const { chartData, chartConfig } = useMemo(() => {
    const config: ChartConfig = {
      inputTokens: { label: t("ai-usage.th.input"), color: "var(--chart-1)" },
      outputTokens: { label: t("ai-usage.th.output"), color: "var(--chart-3)" },
    };

    const models = summary.byModel.map((m) => ({
      model: m.modelId,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
    }));

    return { chartData: models, chartConfig: config };
  }, [summary.byModel, t]);

  return (
    <div className="overflow-hidden">
      <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height }}>
        <BarChart accessibilityLayer data={chartData} layout="vertical">
          <CartesianGrid horizontal={false} />
          <YAxis
            dataKey="model"
            type="category"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={160}
            tick={{ fontSize: 11 }}
            tickFormatter={truncateModel}
          />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatTokens(v)}
          />
          <ChartTooltip content={<ChartTooltipContent labelKey="model" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="inputTokens" stackId="tokens" fill="var(--color-inputTokens)" />
          <Bar
            dataKey="outputTokens"
            stackId="tokens"
            fill="var(--color-outputTokens)"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
