import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Receipt, Search, Zap } from "lucide-react";
import { match } from "ts-pattern";

import { removeTailingZero } from "@/shared/number";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { usePayAgents, usePayAgentTxnsList } from "@/web/api/hooks";
import type { PayAgentTransaction } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Pagination } from "@/web/components/dashboard/pagination";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
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
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default function TransactionLedgerPage() {
  const { t } = useTranslation();
  const { data: agents = [] } = usePayAgents();

  // Draft filters
  const [draftType, setDraftType] = useState("all");
  const [draftAgent, setDraftAgent] = useState("all");
  const [draftSource, setDraftSource] = useState("all");

  // Applied filters
  const [type, setType] = useState<string | undefined>();
  const [agentId, setAgentId] = useState<number | undefined>();
  const [source, setSource] = useState<string | undefined>();
  const [page, setPage] = useState(0);

  const { data: txns = [], isLoading } = usePayAgentTxnsList({
    type,
    agentId,
    source,
    page,
  });

  const hasFilters = draftType !== "all" || draftAgent !== "all" || draftSource !== "all";

  const applyFilters = useCallback(() => {
    setType(draftType !== "all" ? draftType : undefined);
    setAgentId(draftAgent !== "all" ? Number(draftAgent) : undefined);
    setSource(draftSource !== "all" ? draftSource : undefined);
    setPage(0);
  }, [draftType, draftAgent, draftSource]);

  const resetFilters = useCallback(() => {
    setDraftType("all");
    setDraftAgent("all");
    setDraftSource("all");
    setType(undefined);
    setAgentId(undefined);
    setSource(undefined);
    setPage(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  // Agent name lookup
  const agentMap = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div>
      <Header title={t("ledger.title")} description={t("ledger.desc")} />

      <div className="p-4 md:p-8 space-y-4">
        {/* Filters */}
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

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {t("ledger.table-title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : txns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("ledger.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t("common.th.type")}</TableHead>
                      <TableHead className="text-xs">{t("common.th.amount")}</TableHead>
                      <TableHead className="text-xs">{t("ledger.th.balance")}</TableHead>
                      <TableHead className="text-xs">{t("ledger.th.wallet")}</TableHead>
                      <TableHead className="text-xs">{t("common.th.source")}</TableHead>
                      <TableHead className="text-xs">{t("ledger.th.detail")}</TableHead>
                      <TableHead className="text-xs">{t("common.th.time")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.map((tx) => (
                      <TxRow key={tx.id} tx={tx} agentName={agentMap.get(tx.agentId)} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            <Pagination
              page={page}
              onPageChange={setPage}
              currentCount={txns.length}
              pageSize={PAGE_SIZE}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Transaction Row ──────────────────────────────────────────────

function TxRow({ tx, agentName }: { tx: PayAgentTransaction; agentName?: string }) {
  const isCredit = tx.type === "top_up";

  return (
    <TableRow>
      <TableCell>
        <TxTypeBadge type={tx.type} />
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap">
        <span className={isCredit ? "text-green-600" : "text-red-500"}>
          {isCredit ? "+" : "-"}
          {removeTailingZero(tx.amount)} USDC
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {removeTailingZero(tx.balanceBefore)} → {removeTailingZero(tx.balanceAfter)}
      </TableCell>
      <TableCell className="text-xs max-w-[120px]">
        <LocaleLink
          to="/admin/pay-agents"
          className="inline-flex items-center gap-1 text-primary hover:underline truncate"
        >
          {agentName ?? `Agent #${tx.agentId}`}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </LocaleLink>
      </TableCell>
      <TableCell>
        <SourceBadge source={tx.source} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
        <TxDetail tx={tx} />
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {formatDistanceToNow(new Date(tx.createdAt), { addSuffix: true })}
      </TableCell>
    </TableRow>
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
    <Badge variant="outline" className={`text-xs ${config.className}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

function SourceBadge({ source }: { source: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="text-xs">
      {source === "on_chain" ? t("ledger.source.on_chain") : t("ledger.source.platform")}
    </Badge>
  );
}

function TxDetail({ tx }: { tx: PayAgentTransaction }) {
  // AI usage: show model + tokens
  if (tx.type === "ai_usage" && tx.modelId) {
    return (
      <span>
        {tx.modelId} ({tx.tokens ?? 0} tokens)
      </span>
    );
  }

  // On-chain: show tx hash link
  if (tx.txHash) {
    return (
      <span className="inline-flex items-center gap-1 font-mono">
        {tx.txHash.slice(0, 12)}...
        <ExternalLink className="h-3 w-3" />
      </span>
    );
  }

  // Description fallback
  if (tx.description) {
    return <span>{tx.description}</span>;
  }

  return <span>—</span>;
}
