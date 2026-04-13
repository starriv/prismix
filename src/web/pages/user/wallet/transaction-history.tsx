import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Receipt, Search } from "lucide-react";
import { match } from "ts-pattern";

import { removeTailingZero } from "@/shared/number";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useWalletTransactions } from "@/web/api/user-hooks";
import { Pagination } from "@/web/components/dashboard/pagination";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { explorerTxUrl, useChainRegistry } from "@/web/shared/chains";
import { getDateLocale } from "@/web/shared/date-locale";

const TX_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export function TransactionHistory() {
  const { t, i18n } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();

  // Draft filters
  const [draftType, setDraftType] = useState("all");

  // Applied filters + pagination
  const [type, setType] = useState<string | undefined>();
  const [page, setPage] = useState(0);

  const {
    data: transactions = [],
    isLoading,
    isFetching,
  } = useWalletTransactions({
    type,
    limit: TX_PAGE_SIZE,
    offset: page * TX_PAGE_SIZE,
  });

  const hasFilters = draftType !== "all";

  const applyFilters = useCallback(() => {
    setType(draftType !== "all" ? draftType : undefined);
    setPage(0);
  }, [draftType]);

  const resetFilters = useCallback(() => {
    setDraftType("all");
    setType(undefined);
    setPage(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          {t("user.wallet.transactions")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <Select value={draftType} onValueChange={setDraftType}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("user.wallet.filter.all-types")}</SelectItem>
              <SelectItem value="top_up">{t("user.wallet.tx-type.top_up", "Top Up")}</SelectItem>
              <SelectItem value="ai_usage">
                {t("user.wallet.tx-type.ai_usage", "AI Usage")}
              </SelectItem>
              <SelectItem value="withdraw">
                {t("user.wallet.tx-type.withdraw", "Withdraw")}
              </SelectItem>
              <SelectItem value="payment">{t("user.wallet.tx-type.payment", "Payment")}</SelectItem>
              <SelectItem value="admin_debit">
                {t("user.wallet.tx-type.admin_debit", "Admin Debit")}
              </SelectItem>
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
        {isLoading && transactions.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            {t("user.wallet.tx-empty")}
          </p>
        ) : (
          <div className="relative overflow-x-auto">
            <Table className="table-fixed min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[128px] text-xs">{t("common.th.type")}</TableHead>
                  <TableHead className="w-[132px] text-xs">{t("common.th.amount")}</TableHead>
                  <TableHead className="w-[168px] text-xs">{t("user.wallet.th.balance")}</TableHead>
                  <TableHead className="w-[108px] text-xs">{t("common.th.source")}</TableHead>
                  <TableHead className="w-[96px] text-xs">{t("common.th.network")}</TableHead>
                  <TableHead className="text-xs">{t("user.wallet.th.detail")}</TableHead>
                  <TableHead className="w-[124px] text-xs">{t("common.th.time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const chain = tx.network ? getChainDisplayByNetworkId(tx.network) : undefined;
                  const isCredit = tx.type === "top_up";

                  return (
                    <TableRow key={tx.id}>
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
                      <TableCell>
                        <SourceBadge source={tx.source} />
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {chain?.shortName ?? tx.network ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-0 text-xs text-muted-foreground">
                        <TxDetail
                          txHash={tx.txHash}
                          description={tx.description}
                          explorerUrl={chain?.explorerUrl}
                        />
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground whitespace-nowrap cursor-default">
                              {formatDistanceToNow(new Date(tx.createdAt), {
                                addSuffix: true,
                                locale: getDateLocale(i18n.language),
                              })}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{new Date(tx.createdAt).toLocaleString()}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {isFetching && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/40" />
            )}
          </div>
        )}

        {/* Pagination */}
        <Pagination
          page={page}
          onPageChange={setPage}
          currentCount={transactions.length}
          pageSize={TX_PAGE_SIZE}
        />
      </CardContent>
    </Card>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="text-xs">
      {source === "on_chain"
        ? t("user.wallet.source.on_chain", "On-chain")
        : t("user.wallet.source.platform", "Platform")}
    </Badge>
  );
}

function TxDetail({
  txHash,
  description,
  explorerUrl,
}: {
  txHash: string | null;
  description: string | null;
  explorerUrl?: string;
}) {
  if (txHash) {
    const href = explorerUrl ? explorerTxUrl(explorerUrl, txHash) : undefined;
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-1 overflow-hidden font-mono hover:text-foreground transition-colors"
      >
        <span className="truncate">{txHash.slice(0, 12)}...</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    ) : (
      <span className="block truncate font-mono">{txHash.slice(0, 12)}...</span>
    );
  }

  if (description) return <span className="block truncate">{description}</span>;

  return <span>—</span>;
}

function TxTypeBadge({ type }: { type: string }) {
  const { t } = useTranslation();
  const config = match(type)
    .with("top_up", () => ({
      label: t("user.wallet.tx-type.top_up", "Top Up"),
      className: "border-green-500/30 bg-green-500/10 text-green-600",
    }))
    .with("withdraw", () => ({
      label: t("user.wallet.tx-type.withdraw", "Withdraw"),
      className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
    }))
    .with("admin_debit", () => ({
      label: t("user.wallet.tx-type.admin_debit", "Admin Debit"),
      className: "border-red-500/30 bg-red-500/10 text-red-600",
    }))
    .otherwise(() => ({
      label: t(`user.wallet.tx-type.${type}`, type),
      className: "",
    }));

  return (
    <Badge variant="outline" className={`text-xs ${config.className}`}>
      {config.label}
    </Badge>
  );
}
