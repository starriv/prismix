import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Search, Zap } from "lucide-react";
import { match } from "ts-pattern";

import { removeTailingZero } from "@/shared/number";
import { TOKEN_SYMBOL } from "@/shared/tokens";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { usePayAgents, usePayAgentTxnsList } from "@/web/api/hooks";
import type { PayAgentTransaction } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default function TransactionLedgerPage() {
  const { t, i18n } = useTranslation();
  const { data: agents = [] } = usePayAgents();

  // Draft filters
  const [draftType, setDraftType] = useState("all");
  const [draftAgent, setDraftAgent] = useState("all");
  const [draftSource, setDraftSource] = useState("all");

  // Applied filters
  const [type, setType] = useState<string | undefined>();
  const [agentId, setAgentId] = useState<number | undefined>();
  const [source, setSource] = useState<string | undefined>();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  const {
    data: txnsData,
    isLoading,
    isFetching,
  } = usePayAgentTxnsList({
    type,
    agentId,
    source,
    page: pagination.pageIndex,
  });
  const txns = useMemo(() => txnsData?.items ?? [], [txnsData?.items]);
  const txnPageCount = Math.ceil((txnsData?.total ?? 0) / PAGE_SIZE);

  const hasFilters =
    draftType !== "all" ||
    draftAgent !== "all" ||
    draftSource !== "all" ||
    type !== undefined ||
    agentId !== undefined ||
    source !== undefined;

  const applyFilters = useCallback(() => {
    setType(draftType !== "all" ? draftType : undefined);
    setAgentId(draftAgent !== "all" ? Number(draftAgent) : undefined);
    setSource(draftSource !== "all" ? draftSource : undefined);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftType, draftAgent, draftSource]);

  const resetFilters = useCallback(() => {
    setDraftType("all");
    setDraftAgent("all");
    setDraftSource("all");
    setType(undefined);
    setAgentId(undefined);
    setSource(undefined);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  const columns = useMemo<ColumnDef<PayAgentTransaction>[]>(() => {
    const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));

    return [
      {
        accessorKey: "type",
        cell: ({ row }) => <TxTypeBadge type={row.original.type} />,
        header: t("common.th.type"),
        meta: { headerClassName: "w-[140px] text-xs" },
      },
      {
        accessorKey: "amount",
        cell: ({ row }) => {
          const isCredit = row.original.type === "top_up";
          return (
            <DataTableText mono nowrap className={isCredit ? "text-green-600" : "text-red-500"}>
              {isCredit ? "+" : "-"}
              {removeTailingZero(row.original.amount)} {TOKEN_SYMBOL}
            </DataTableText>
          );
        },
        header: t("common.th.amount"),
        meta: { headerClassName: "w-[136px] text-xs" },
      },
      {
        accessorKey: "balanceAfter",
        cell: ({ row }) => (
          <DataTableText mono muted nowrap>
            {removeTailingZero(row.original.balanceBefore)} →{" "}
            {removeTailingZero(row.original.balanceAfter)}
          </DataTableText>
        ),
        header: t("ledger.th.balance"),
        meta: { headerClassName: "w-[176px] text-xs" },
      },
      {
        accessorKey: "agentId",
        cell: ({ row }) => (
          <LocaleLink
            to={`/admin/pay-agents?id=${row.original.agentId}`}
            className="inline-flex max-w-full items-center gap-1 overflow-hidden text-primary hover:underline"
          >
            <span className="truncate">
              {agentMap.get(row.original.agentId) ?? `Agent #${row.original.agentId}`}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </LocaleLink>
        ),
        header: t("ledger.th.wallet"),
        meta: { headerClassName: "w-[180px] text-xs" },
      },
      {
        accessorKey: "source",
        cell: ({ row }) => <SourceBadge source={row.original.source} />,
        header: t("common.th.source"),
        meta: { headerClassName: "w-[108px] text-xs" },
      },
      {
        id: "detail",
        cell: ({ row }) => (
          <div className="max-w-0 text-xs text-muted-foreground">
            <TxDetail tx={row.original} />
          </div>
        ),
        header: t("ledger.th.detail"),
        meta: { headerClassName: "text-xs" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("common.th.time"),
        meta: { headerClassName: "w-[124px] text-xs" },
      },
    ];
  }, [agents, i18n.language, t]);

  return (
    <div>
      <Header title={t("ledger.title")} description={t("ledger.desc")} />

      <div className="p-4 md:p-8 space-y-4">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            <Select value={draftType} onValueChange={setDraftType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("ledger.filter.type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ledger.filter.all-types")}</SelectItem>
                <SelectItem value="top_up">{t("ledger.type.top_up")}</SelectItem>
                <SelectItem value="ai_usage">{t("ledger.type.ai_usage")}</SelectItem>
                <SelectItem value="withdraw">{t("ledger.type.withdraw")}</SelectItem>
                <SelectItem value="payment">{t("ledger.type.payment")}</SelectItem>
                <SelectItem value="admin_debit">{t("ledger.type.admin_debit")}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={draftSource} onValueChange={setDraftSource}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("ledger.filter.source")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ledger.filter.all-sources")}</SelectItem>
                <SelectItem value="platform">{t("ledger.source.platform")}</SelectItem>
                <SelectItem value="on_chain">{t("ledger.source.on_chain")}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={draftAgent} onValueChange={setDraftAgent}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("ledger.filter.agent")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ledger.filter.all-agents")}</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters} onKeyDown={handleKeyDown}>
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

          <DataTable
            columns={columns}
            data={txns}
            emptyText={t("ledger.empty")}
            getRowId={(row) => String(row.id)}
            loading={
              isLoading
                ? { initial: true, fetching: false }
                : { initial: false, fetching: isFetching }
            }
            manualPagination
            onPaginationChange={setPagination}
            pageCount={txnPageCount}
            pagination={pagination}
            tableClassName="min-w-[1080px]"
          />
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function TxTypeBadge({ type }: { type: string }) {
  const { t } = useTranslation();

  const config = match(type)
    .with("top_up", () => ({
      label: t("ledger.type.top_up"),
      icon: <ArrowDownLeft className="mr-1 h-3 w-3" />,
      className: "border-green-500/30 bg-green-500/10 text-green-600",
    }))
    .with("ai_usage", () => ({
      label: t("ledger.type.ai_usage"),
      icon: <Zap className="mr-1 h-3 w-3" />,
      className: "",
    }))
    .with("withdraw", () => ({
      label: t("ledger.type.withdraw"),
      icon: <ArrowUpRight className="mr-1 h-3 w-3" />,
      className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
    }))
    .with("payment", () => ({
      label: t("ledger.type.payment"),
      icon: null,
      className: "",
    }))
    .with("admin_debit", () => ({
      label: t("ledger.type.admin_debit"),
      icon: null,
      className: "border-red-500/30 bg-red-500/10 text-red-600",
    }))
    .otherwise(() => ({
      label: type,
      icon: null,
      className: "",
    }));

  return (
    <DataTableBadge variant="outline" className={config.className}>
      {config.icon}
      {config.label}
    </DataTableBadge>
  );
}

function SourceBadge({ source }: { source: string }) {
  const { t } = useTranslation();
  return (
    <DataTableBadge variant="outline">
      {source === "on_chain" ? t("ledger.source.on_chain") : t("ledger.source.platform")}
    </DataTableBadge>
  );
}

function TxDetail({ tx }: { tx: PayAgentTransaction }) {
  // AI usage: show model + tokens
  if (tx.type === "ai_usage" && tx.modelId) {
    return (
      <span className="block truncate">
        {tx.modelId} ({tx.tokens ?? 0} tokens)
      </span>
    );
  }

  // On-chain: show tx hash link
  if (tx.txHash) {
    return (
      <span className="inline-flex max-w-full items-center gap-1 overflow-hidden font-mono">
        <span className="truncate">{tx.txHash.slice(0, 12)}...</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </span>
    );
  }

  // Description fallback
  if (tx.description) {
    return <span className="block truncate">{tx.description}</span>;
  }

  return <span>—</span>;
}
