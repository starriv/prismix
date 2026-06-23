import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Brain, Info, Search, Sparkles } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";

import { useUserModels } from "@/web/api/user-hooks";
import type { UserModel, UserModelProvider } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
  DataTableToolbar,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Skeleton } from "@/web/components/ui/skeleton";
import { cn } from "@/web/shared/utils";

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "";
}

export default function UserModelsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useUserModels();
  const [providerId, setProviderId] = useQueryState("providerId", parseAsInteger);

  const providers = data?.providers ?? [];
  const markupPercent = data?.markupPercent ?? 0;

  const selectedProvider = providers.find((p) => p.id === providerId) ?? null;

  const handleBack = useCallback(() => setProviderId(null), [setProviderId]);
  const handleSelect = useCallback((p: UserModelProvider) => setProviderId(p.id), [setProviderId]);

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

        {selectedProvider ? (
          <ModelList provider={selectedProvider} onBack={handleBack} />
        ) : (
          <ProviderGrid providers={providers} loading={isLoading} onSelect={handleSelect} />
        )}
      </div>
    </div>
  );
}

// ── Provider Grid ───────────────────────────────────────────────

function ProviderGrid({
  providers,
  loading,
  onSelect,
}: {
  providers: UserModelProvider[];
  loading: boolean;
  onSelect: (p: UserModelProvider) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </Card>
        ))}
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Brain className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("user-models.no-providers")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} onClick={() => onSelect(provider)} />
      ))}
    </div>
  );
}

function ProviderCard({ provider, onClick }: { provider: UserModelProvider; onClick: () => void }) {
  const { t } = useTranslation();
  const limitedFreeCount = provider.models.filter((model) => model.isLimitedFree).length;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/30",
        "flex flex-col justify-between",
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold truncate">{provider.name}</h3>
          <Badge variant="secondary" className="text-xs tabular-nums">
            {provider.models.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {provider.iconUrl ? (
            <img
              src={provider.iconUrl}
              alt={provider.name}
              className="h-8 w-8 rounded-md object-contain"
              width={32}
              height={32}
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
          )}
          <Badge variant="outline" className="text-xs">
            {provider.apiFormat}
          </Badge>
          {limitedFreeCount > 0 && (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              {t("user-models.tag.limited-free")}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Model List ──────────────────────────────────────────────────

function ModelList({ provider, onBack }: { provider: UserModelProvider; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return provider.models;
    return provider.models.filter(
      (m) => m.modelId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [provider.models, search]);

  const columns = useMemo<ColumnDef<UserModel>[]>(
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
        id: "capabilities",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.capabilities.map((cap) => (
              <DataTableBadge key={cap} variant="outline">
                {cap}
              </DataTableBadge>
            ))}
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
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={t("common.btn.back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            {provider.iconUrl ? (
              <img
                src={provider.iconUrl}
                alt={provider.name}
                className="h-6 w-6 rounded object-contain"
                width={24}
                height={24}
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <CardTitle className="text-base">{provider.name}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={filteredModels}
          emptyText={t("user-models.empty")}
          tableClassName="min-w-[760px]"
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
                      total: provider.models.length,
                    })
                  : t("user-models.filter-count", { count: provider.models.length })}
              </span>
            </DataTableToolbar>
          }
        />
      </CardContent>
    </Card>
  );
}
