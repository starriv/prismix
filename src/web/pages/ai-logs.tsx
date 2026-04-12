import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { sortBy } from "lodash-es";
import { Search } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";

import { PAGE_SIZE, useAiLogs, useAiRequestLog, useRelayKeys } from "@/web/api/hooks";
import type { AiUsageRecord } from "@/web/api/schemas";
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

import { buildLogColumns } from "./ai-logs/log-columns";
import { LogDetail } from "./ai-logs/log-detail";

export default function AiLogsPage() {
  const { t, i18n } = useTranslation();

  // Applied state — URL-persisted, drives query
  const [appliedModel, setAppliedModel] = useQueryState("model", parseAsString.withDefault("all"));
  const [appliedKey, setAppliedKey] = useQueryState("key", parseAsString.withDefault("all"));
  const [appliedStatus, setAppliedStatus] = useQueryState(
    "status",
    parseAsString.withDefault("all"),
  );
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(0));

  // Draft state — local UI
  const [draftModel, setDraftModel] = useState(appliedModel);
  const [draftKey, setDraftKey] = useState(appliedKey);
  const [draftStatus, setDraftStatus] = useState(appliedStatus);

  // Data — auto-refresh every 5s
  const LIVE_REFETCH_MS = 5_000;
  const { data: keys = [] } = useRelayKeys();
  const {
    data: logs = [],
    isLoading,
    isFetching,
  } = useAiLogs({
    modelId: appliedModel !== "all" ? appliedModel : undefined,
    consumerKeyId: appliedKey !== "all" ? Number(appliedKey) : undefined,
    statusClass: appliedStatus === "4xx" || appliedStatus === "5xx" ? appliedStatus : undefined,
    page,
    refetchInterval: LIVE_REFETCH_MS,
  });

  // Derive unique models from current page
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.modelId) set.add(l.modelId);
    }
    return sortBy(Array.from(set));
  }, [logs]);

  const [selected, setSelected] = useState<AiUsageRecord | null>(null);

  const hasFilters = draftModel !== "all" || draftKey !== "all" || draftStatus !== "all";

  const applyFilters = useCallback(() => {
    setAppliedModel(draftModel);
    setAppliedKey(draftKey);
    setAppliedStatus(draftStatus);
    setPage(0);
  }, [
    draftKey,
    draftModel,
    draftStatus,
    setAppliedKey,
    setAppliedModel,
    setAppliedStatus,
    setPage,
  ]);

  const resetFilters = useCallback(() => {
    setDraftModel("all");
    setDraftKey("all");
    setDraftStatus("all");
    setAppliedModel("all");
    setAppliedKey("all");
    setAppliedStatus("all");
    setPage(0);
  }, [setAppliedKey, setAppliedModel, setAppliedStatus, setPage]);

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

              <Select value={draftKey} onValueChange={setDraftKey}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("ai-logs.filter.all-keys")}</SelectItem>
                  {keys.map((k) => (
                    <SelectItem key={k.id} value={String(k.id)}>
                      {k.name}
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

              {/* Live indicator — right-aligned */}
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
              loading={
                isLoading
                  ? { initial: true, fetching: false }
                  : { initial: false, fetching: isFetching }
              }
              onRowClick={setSelected}
              page={page}
              onPageChange={setPage}
              pageSize={PAGE_SIZE}
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
            <SheetBody>
              {selected && <AdminLogDetailWrapper log={selected} keys={keys} />}
            </SheetBody>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

// ── Admin detail wrapper (resolves keyName + request body) ──────────

function AdminLogDetailWrapper({
  log,
  keys,
}: {
  log: AiUsageRecord;
  keys: { id: number; name: string }[];
}) {
  const { data: requestLog, isLoading: bodyLoading } = useAiRequestLog(log.requestId);
  const keyName = keys.find((k) => k.id === log.consumerKeyId)?.name;

  return (
    <LogDetail log={log} keyName={keyName} requestLog={requestLog} bodyLoading={bodyLoading} />
  );
}
