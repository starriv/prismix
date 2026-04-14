import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OnChangeFn, PaginationState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { sortBy } from "lodash-es";
import { Search } from "lucide-react";

import type { AiUsageRecord } from "@/web/api/schemas";
import {
  USER_LOG_PAGE_SIZE,
  useUserLogs,
  useUserModels,
  useUserRequestLog,
} from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { DataTable, DataTableToolbar, DataTableViewOptions } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";

import { LogDetail } from "../ai-logs/log-detail";
import { buildUserLogColumns } from "./log-columns";

const LIVE_REFETCH_MS = 5_000;
const EMPTY_LOGS: AiUsageRecord[] = [];

export default function UserLogsPage() {
  const { t, i18n } = useTranslation();

  // Applied + draft filter state
  const [appliedModel, setAppliedModel] = useState("all");
  const [draftModel, setDraftModel] = useState("all");
  const [appliedStatus, setAppliedStatus] = useState("all");
  const [draftStatus, setDraftStatus] = useState("all");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: USER_LOG_PAGE_SIZE,
  });

  const {
    data: logsData,
    isLoading,
    isFetching,
  } = useUserLogs({
    modelId: appliedModel !== "all" ? appliedModel : undefined,
    statusClass: appliedStatus === "4xx" || appliedStatus === "5xx" ? appliedStatus : undefined,
    page: pagination.pageIndex,
    refetchInterval: LIVE_REFETCH_MS,
  });

  const logs = logsData?.items ?? EMPTY_LOGS;

  // Derive model options from full catalog (not current page)
  const { data: modelCatalog } = useUserModels();
  const modelOptions = useMemo(() => {
    if (!modelCatalog) return [];
    return sortBy(modelCatalog.providers.flatMap((p) => p.models.map((m) => m.modelId)));
  }, [modelCatalog]);

  const [selected, setSelected] = useState<AiUsageRecord | null>(null);

  const hasFilters = draftModel !== "all" || draftStatus !== "all";

  const applyFilters = useCallback(() => {
    setAppliedModel(draftModel);
    setAppliedStatus(draftStatus);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftModel, draftStatus]);

  const resetFilters = useCallback(() => {
    setDraftModel("all");
    setDraftStatus("all");
    setAppliedModel("all");
    setAppliedStatus("all");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>((updater) => {
    setPagination((prev) => ({
      ...functionalUpdate(updater, prev),
      pageSize: USER_LOG_PAGE_SIZE,
    }));
  }, []);

  const columns = useMemo(() => buildUserLogColumns(t, i18n.language), [t, i18n.language]);

  return (
    <div>
      <Header title={t("ai-logs.title")} description={t("ai-logs.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("ai-logs.card-title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DataTable
              columns={columns}
              data={logs}
              emptyText={t("ai-logs.table-empty")}
              loading={{ initial: isLoading, fetching: isFetching }}
              manualPagination
              onPaginationChange={handlePaginationChange}
              onRowClick={setSelected}
              pagination={pagination}
              rowCount={logsData?.total ?? 0}
              tableClassName="min-w-[860px]"
              toolbar={(table) => (
                <DataTableToolbar>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <Select value={draftModel} onValueChange={setDraftModel}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("ai-logs.filter.all-models")}</SelectItem>
                        {modelOptions.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={draftStatus} onValueChange={setDraftStatus}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("ai-logs.filter.all-status")}</SelectItem>
                        <SelectItem value="4xx">4xx</SelectItem>
                        <SelectItem value="5xx">5xx</SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={applyFilters}>
                        <Search className="mr-1 h-3.5 w-3.5" />
                        {t("common.btn.search")}
                      </Button>
                      {hasFilters && (
                        <Button size="sm" variant="outline" onClick={resetFilters}>
                          {t("common.btn.reset")}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:ml-auto">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                      </span>
                      <span>{t("ai-logs.live")}</span>
                    </div>
                    <DataTableViewOptions table={table} />
                  </div>
                </DataTableToolbar>
              )}
            />
          </CardContent>
        </Card>

        {/* Detail Sheet */}
        <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
          <SheetContent className="w-full sm:w-[520px]">
            <SheetHeader>
              <SheetTitle>
                {selected ? t("ai-logs.detail.title", { id: selected.id }) : ""}
              </SheetTitle>
            </SheetHeader>
            <SheetBody>{selected && <UserLogDetailWrapper log={selected} />}</SheetBody>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

// ── User detail wrapper (resolves request body) ─────────────────────

function UserLogDetailWrapper({ log }: { log: AiUsageRecord }) {
  const { data: requestLog, isLoading: bodyLoading } = useUserRequestLog(log.requestId);

  return <LogDetail log={log} requestLog={requestLog} bodyLoading={bodyLoading} />;
}
