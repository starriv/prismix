import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { ArrowRight } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import type {
  AiUsageByKey,
  AiUsageRecord,
  AiUsageSummary,
  RelayKeyOption,
} from "@/web/api/schemas";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";

import { formatTokens, StatusBadge } from "./helpers";

type KeyMap = Record<number, RelayKeyOption | undefined>;
type ProviderRow = AiUsageSummary["byProvider"][number];
type ModelRow = AiUsageSummary["byModel"][number];

export function buildAiUsageByKeyColumns({
  keyMap,
  t,
}: {
  keyMap: KeyMap;
  t: TFunction;
}): ColumnDef<AiUsageByKey>[] {
  return [
    {
      accessorKey: "consumerKeyId",
      cell: ({ row }) => {
        const keyInfo = keyMap[row.original.consumerKeyId];
        return (
          <div className="flex items-center gap-2">
            <DataTableText className="font-medium">
              {keyInfo?.name ?? `Key #${row.original.consumerKeyId}`}
            </DataTableText>
            {keyInfo && (
              <Badge variant="outline" className="font-mono text-xs">
                {keyInfo.apiKeyPrefix}
              </Badge>
            )}
          </div>
        );
      },
      header: t("ai-usage.th.key-name"),
      meta: {
        headerClassName: "w-[32%]",
      },
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {row.original.requests}
        </DataTableText>
      ),
      header: t("ai-usage.th.requests"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "inputTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.inputTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.input"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "outputTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.outputTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.output"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.totalTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.total"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => (
        <DataTableText
          mono
          numeric
        >{`$${removeTailingZero(row.original.estimatedCost, 4)}`}</DataTableText>
      ),
      header: t("ai-usage.th.cost"),
      meta: {
        headerClassName: "w-[14%]",
        ...dataTableMeta.right,
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="text-right">
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <LocaleLink to={`/admin/ai-usage?key=${row.original.consumerKeyId}`}>
              <ArrowRight className="h-3.5 w-3.5" />
            </LocaleLink>
          </Button>
        </div>
      ),
      enableHiding: false,
      header: "",
      meta: {
        headerClassName: "w-[48px]",
        ...dataTableMeta.right,
      },
    },
  ];
}

export function buildAiUsageProviderColumns(t: TFunction): ColumnDef<ProviderRow>[] {
  return [
    {
      accessorKey: "providerId",
      cell: ({ row }) => (
        <DataTableText className="font-medium">{row.original.providerId}</DataTableText>
      ),
      header: t("ai-usage.th.provider"),
      meta: { headerClassName: "w-[24%]" },
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {row.original.requests}
        </DataTableText>
      ),
      header: t("ai-usage.th.requests"),
      meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "inputTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.inputTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.input"),
      meta: { headerClassName: "w-[14%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "outputTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.outputTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.output"),
      meta: { headerClassName: "w-[14%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.totalTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.total"),
      meta: { headerClassName: "w-[16%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => (
        <DataTableText
          mono
          numeric
        >{`$${removeTailingZero(row.original.estimatedCost, 4)}`}</DataTableText>
      ),
      header: t("ai-usage.th.cost"),
      meta: { headerClassName: "w-[20%]", ...dataTableMeta.right },
    },
  ];
}

export function buildAiUsageModelColumns(t: TFunction): ColumnDef<ModelRow>[] {
  return [
    {
      accessorKey: "providerId",
      cell: ({ row }) => (
        <DataTableText className="font-medium">{row.original.providerId}</DataTableText>
      ),
      header: t("ai-usage.th.provider"),
      meta: { headerClassName: "w-[16%]" },
    },
    {
      accessorKey: "modelId",
      cell: ({ row }) => <DataTableText mono>{row.original.modelId}</DataTableText>,
      header: t("ai-usage.th.model"),
      meta: { headerClassName: "w-[24%]" },
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {row.original.requests}
        </DataTableText>
      ),
      header: t("ai-usage.th.requests"),
      meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "inputTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.inputTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.input"),
      meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "outputTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.outputTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.output"),
      meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.totalTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.total"),
      meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => (
        <DataTableText
          mono
          numeric
        >{`$${removeTailingZero(row.original.estimatedCost, 4)}`}</DataTableText>
      ),
      header: t("ai-usage.th.cost"),
      meta: { headerClassName: "w-[14%]", ...dataTableMeta.right },
    },
  ];
}

export function buildAiUsageRecentColumns({
  language,
  t,
}: {
  language: string;
  t: TFunction;
}): ColumnDef<AiUsageRecord>[] {
  return [
    {
      accessorKey: "modelId",
      cell: ({ row }) => <DataTableText mono>{row.original.modelId ?? "-"}</DataTableText>,
      header: t("ai-usage.th.model"),
      meta: { headerClassName: "w-[18%]" },
    },
    {
      accessorKey: "upstreamName",
      cell: ({ row }) => (
        <DataTableText className="max-w-[220px]" truncate>
          {row.original.upstreamName ?? row.original.upstreamBaseUrl ?? "-"}
        </DataTableText>
      ),
      header: t("ai-usage.th.upstream"),
      meta: { headerClassName: "w-[26%]" },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatTokens(row.original.totalTokens)}
        </DataTableText>
      ),
      header: t("ai-usage.th.tokens"),
      meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {row.original.estimatedCost
            ? `$${removeTailingZero(row.original.estimatedCost, 6)}`
            : "-"}
        </DataTableText>
      ),
      header: t("ai-usage.th.cost"),
      meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "latencyMs",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {row.original.latencyMs != null ? `${row.original.latencyMs}ms` : "-"}
        </DataTableText>
      ),
      header: t("ai-usage.th.latency"),
      meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
    },
    {
      accessorKey: "statusCode",
      cell: ({ row }) => <StatusBadge code={row.original.statusCode} error={row.original.error} />,
      header: t("ai-usage.th.status"),
      meta: { headerClassName: "w-[10%]" },
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      header: t("ai-usage.th.time"),
      meta: { headerClassName: "w-[12%]" },
    },
  ];
}
