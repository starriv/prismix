import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OnChangeFn, PaginationState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { sortBy } from "lodash-es";
import { Search } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useAiLogs, useAiRequestLog, useRelayKeyOptions } from "@/web/api/hooks";
import type { AiUsageRecord } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { DataTable } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/web/components/ui/sheet";

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
  const [appliedRequestId, setAppliedRequestId] = useQueryState("requestId");
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(0));

  // Draft state — local UI
  const [draftModel, setDraftModel] = useState(appliedModel);
  const [draftKey, setDraftKey] = useState(appliedKey);
  const [draftStatus, setDraftStatus] = useState(appliedStatus);
  const [draftRequestId, setDraftRequestId] = useState(appliedRequestId ?? "");

  // Keep draft controls aligned with URL-backed filters after navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Draft controls mirror URL-backed filters after browser navigation.
    setDraftModel(appliedModel);
    setDraftKey(appliedKey);
    setDraftStatus(appliedStatus);
    setDraftRequestId(appliedRequestId ?? "");
  }, [appliedKey, appliedModel, appliedRequestId, appliedStatus]);

  // Data — auto-refresh every 5s
  const LIVE_REFETCH_MS = 5_000;
  const { data: keys = [] } = useRelayKeyOptions();
  const {
    data: logsData,
    isLoading,
    isFetching,
  } = useAiLogs({
    modelId: appliedModel !== "all" ? appliedModel : undefined,
    consumerKeyId: appliedKey !== "all" ? Number(appliedKey) : undefined,
    statusClass: appliedStatus === "4xx" || appliedStatus === "5xx" ? appliedStatus : undefined,
    requestId: appliedRequestId ?? undefined,
    page,
    refetchInterval: LIVE_REFETCH_MS,
  });
  const logs = useMemo(() => logsData?.items ?? [], [logsData?.items]);
  const logPageCount = Math.ceil((logsData?.total ?? 0) / DEFAULT_PAGE_SIZE);

  // Derive unique models from current page
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.modelId) set.add(l.modelId);
    }
    return sortBy(Array.from(set));
  }, [logs]);

  const [selected, setSelected] = useState<AiUsageRecord | null>(null);

  const hasFilters =
    draftModel !== "all" || draftKey !== "all" || draftStatus !== "all" || draftRequestId !== "";

  const applyFilters = useCallback(() => {
    setAppliedModel(draftModel);
    setAppliedKey(draftKey);
    setAppliedStatus(draftStatus);
    setAppliedRequestId(draftRequestId || null);
    setPage(0);
  }, [
    draftKey,
    draftModel,
    draftRequestId,
    draftStatus,
    setAppliedKey,
    setAppliedModel,
    setAppliedRequestId,
    setAppliedStatus,
    setPage,
  ]);

  const resetFilters = useCallback(() => {
    setDraftModel("all");
    setDraftKey("all");
    setDraftStatus("all");
    setDraftRequestId("");
    setAppliedModel("all");
    setAppliedKey("all");
    setAppliedStatus("all");
    setAppliedRequestId(null);
    setPage(0);
  }, [setAppliedKey, setAppliedModel, setAppliedRequestId, setAppliedStatus, setPage]);

  const columns = useMemo(() => buildLogColumns(t, i18n.language), [t, i18n.language]);
  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: page, pageSize: DEFAULT_PAGE_SIZE }),
    [page],
  );
  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next = functionalUpdate(updater, pagination);
      setPage(next.pageIndex);
    },
    [pagination, setPage],
  );

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
              <Input
                className="w-[220px] font-mono text-xs"
                placeholder={t("ai-logs.filter.request-id-ph")}
                value={draftRequestId}
                onChange={(e) => setDraftRequestId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
              />

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
              emptyText={t("ai-logs.table-empty")}
              getRowId={(row) => String(row.id)}
              loading={
                isLoading
                  ? { initial: true, fetching: false }
                  : { initial: false, fetching: isFetching }
              }
              manualPagination
              onRowClick={setSelected}
              onPaginationChange={handlePaginationChange}
              pageCount={logPageCount}
              pagination={pagination}
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
              <SheetDescription className="sr-only">
                {t("ai-logs.detail.overview")}
              </SheetDescription>
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
