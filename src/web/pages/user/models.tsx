import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { Brain, Info, Search } from "lucide-react";

import { useUserModels } from "@/web/api/user-hooks";
import type { UserModel, UserModelEndpoint } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
  DataTableToolbar,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "";
}

type CatalogModel = UserModel;

const EMPTY_USER_MODEL_ENDPOINTS: UserModelEndpoint[] = [];

function compareCatalogModels(a: CatalogModel, b: CatalogModel): number {
  return a.modelId.localeCompare(b.modelId, undefined, { numeric: true, sensitivity: "base" });
}

function flattenCatalogModels(endpoints: UserModelEndpoint[]): CatalogModel[] {
  const byModelId = new Map<string, CatalogModel>();

  for (const endpoint of endpoints) {
    for (const model of endpoint.models) {
      const current = byModelId.get(model.modelId);
      if (!current) byModelId.set(model.modelId, model);
    }
  }

  return Array.from(byModelId.values()).sort(compareCatalogModels);
}

export default function UserModelsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useUserModels();

  const endpoints = data?.endpoints ?? EMPTY_USER_MODEL_ENDPOINTS;
  const models = useMemo(() => flattenCatalogModels(endpoints), [endpoints]);
  const markupPercent = data?.markupPercent ?? 0;

  return (
    <div>
      <Header title={t("user-models.title")} description={t("user-models.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        {markupPercent > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-primary" />
                {t("user-models.markup-note", { markup: markupPercent })}
              </p>
            </CardContent>
          </Card>
        )}

        <ModelCatalogTable loading={isLoading} models={models} />
      </div>
    </div>
  );
}

// ── Model Catalog ───────────────────────────────────────────────

function ModelCatalogTable({ loading, models }: { loading: boolean; models: CatalogModel[] }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.modelId.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.capabilities.some((cap) => cap.toLowerCase().includes(q)),
    );
  }, [models, search]);

  const columns = useMemo<ColumnDef<CatalogModel>[]>(
    () => [
      {
        accessorKey: "modelId",
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <DataTableBadge variant="secondary" className="font-mono">
              {row.original.modelId}
            </DataTableBadge>
            {row.original.isLimitedFree && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                title={t("user-models.tag.limited-free-until", {
                  time: formatDateTime(row.original.limitedFreeUntil, i18n.language),
                })}
              >
                {t("user-models.tag.limited-free")}
              </Badge>
            )}
          </div>
        ),
        header: t("user-models.th.model-id"),
      },
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("user-models.th.name"),
      },
      {
        accessorKey: "consumerInputPrice",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            ${row.original.consumerInputPrice}
          </DataTableText>
        ),
        header: t("user-models.th.input-price"),
        meta: dataTableMeta.right,
      },
      {
        accessorKey: "consumerOutputPrice",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            ${row.original.consumerOutputPrice}
          </DataTableText>
        ),
        header: t("user-models.th.output-price"),
        meta: dataTableMeta.right,
      },
      {
        accessorKey: "contextWindow",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.contextWindow
              ? row.original.contextWindow.toLocaleString(i18n.language)
              : "-"}
          </DataTableText>
        ),
        header: t("user-models.th.context-window"),
        meta: dataTableMeta.right,
      },
      {
        id: "capabilities",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.capabilities.length > 0 ? (
              row.original.capabilities.map((cap) => (
                <DataTableBadge key={cap} variant="outline">
                  {cap}
                </DataTableBadge>
              ))
            ) : (
              <DataTableText className="text-muted-foreground">-</DataTableText>
            )}
          </div>
        ),
        header: t("user-models.th.capabilities"),
        meta: dataTableMeta.wrap,
      },
    ],
    [i18n.language, t],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4" />
          {t("user-models.catalog-title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={filteredModels}
          emptyText={t("user-models.empty")}
          getRowId={(row) => row.modelId}
          loading={loading}
          tableClassName="min-w-[900px]"
          toolbar={
            <DataTableToolbar>
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8 h-8 text-sm"
                  placeholder={t("user-models.filter-ph")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {search.trim()
                  ? t("user-models.filter-count-filtered", {
                      filtered: filteredModels.length,
                      total: models.length,
                    })
                  : t("user-models.filter-count", { count: models.length })}
              </span>
            </DataTableToolbar>
          }
        />
      </CardContent>
    </Card>
  );
}
