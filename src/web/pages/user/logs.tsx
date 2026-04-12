import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { sortBy } from "lodash-es";
import { Search } from "lucide-react";

import type { AiUsageRecord } from "@/web/api/schemas";
import { USER_LOG_PAGE_SIZE, useUserLogs, useUserRequestLog } from "@/web/api/user-hooks";
import { DataTable } from "@/web/components/dashboard/data-table";
import { Header } from "@/web/components/dashboard/header";
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

import { buildLogColumns } from "../ai-logs/log-columns";
import { LogDetail } from "../ai-logs/log-detail";

const LIVE_REFETCH_MS = 5_000;

export default function UserLogsPage() {
  const { t, i18n } = useTranslation();

  // Applied + draft filter state
  const [appliedModel, setAppliedModel] = useState("all");
  const [draftModel, setDraftModel] = useState("all");
  const [page, setPage] = useState(0);

  const {
    data: logsData,
    isLoading,
    isFetching,
  } = useUserLogs({
    modelId: appliedModel !== "all" ? appliedModel : undefined,
    page,
    refetchInterval: LIVE_REFETCH_MS,
  });

  const logs = logsData?.items ?? [];

  // Derive unique models from current page
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.modelId) set.add(l.modelId);
    }
    return sortBy(Array.from(set));
  }, [logs]);

  const [selected, setSelected] = useState<AiUsageRecord | null>(null);

  const hasFilters = draftModel !== "all";

  const applyFilters = useCallback(() => {
    setAppliedModel(draftModel);
    setPage(0);
  }, [draftModel]);

  const resetFilters = useCallback(() => {
    setDraftModel("all");
    setAppliedModel("all");
    setPage(0);
  }, []);

  const columns = useMemo(() => buildLogColumns(t, i18n.language), [t, i18n.language]);

  return (
    <div>
      <Header title={t("ai-logs.title")} description={t("ai-logs.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("ai-logs.card-title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
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

              {/* Live indicator */}
              <div className="flex items-center gap-1.5 sm:ml-auto text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span>{t("ai-logs.live")}</span>
              </div>
            </div>

            {/* Table */}
            <DataTable
              columns={columns}
              data={logs}
              rowKey={(r) => r.id}
              emptyText={t("ai-logs.table-empty")}
              loading={{ initial: isLoading, fetching: false }}
              onRowClick={setSelected}
              page={page}
              onPageChange={setPage}
              pageSize={USER_LOG_PAGE_SIZE}
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
