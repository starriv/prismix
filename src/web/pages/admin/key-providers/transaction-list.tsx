import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { KeyRound } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { useKeyProviderTxns } from "@/web/api/hooks";
import { Pagination } from "@/web/components/dashboard/pagination";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { cn } from "@/web/shared/utils";

import { PREVIEW_COUNT } from "./constants";

export function TransactionList({
  providerId,
  keyLabels,
  previewCount = PREVIEW_COUNT,
  defaultExpanded = false,
  paginated = false,
}: {
  providerId: number;
  keyLabels?: Record<number, string>;
  previewCount?: number;
  defaultExpanded?: boolean;
  paginated?: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const pageSize = paginated ? previewCount : 50;
  const offset = useMemo(() => (paginated ? page * pageSize : 0), [page, pageSize, paginated]);
  const { data: txns = [] } = useKeyProviderTxns(providerId, { limit: pageSize, offset });
  const [expanded, setExpanded] = useState(defaultExpanded);
  const displayTxns = paginated ? txns : expanded ? txns : txns.slice(0, previewCount);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{t("admin.key-providers.detail.txns")}</CardTitle>
          {!paginated && txns.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {txns.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {txns.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            {t("admin.key-providers.detail.no-txns")}
          </p>
        ) : (
          <div className="space-y-2">
            <div
              className={cn("space-y-2", !paginated && expanded && "max-h-80 overflow-y-auto pr-1")}
            >
              {displayTxns.map((tx) => (
                <div key={tx.id} className="rounded-lg border bg-muted/30 px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        <KeyRound className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-sm font-medium">
                        {t(`admin.key-providers.txn-type.${tx.type}`, { defaultValue: tx.type })}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-mono text-xs">
                      ${removeTailingZero(tx.amount)}
                    </Badge>
                  </div>
                  {tx.keyId != null && (
                    <p className="text-xs text-muted-foreground pl-10">
                      {t("admin.key-providers.detail.txn-key", {
                        defaultValue: "Key: {{name}} (#{{id}})",
                        name: keyLabels?.[tx.keyId] ?? `#${tx.keyId}`,
                        id: tx.keyId,
                      })}
                    </p>
                  )}
                  {tx.description && (
                    <p className="text-xs text-muted-foreground pl-10 break-all">
                      {tx.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {!paginated && txns.length > previewCount && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? t("admin.key-providers.detail.collapse")
                  : t("admin.key-providers.detail.view-all", { count: txns.length })}
              </Button>
            )}
            {paginated && (
              <Pagination
                page={page}
                onPageChange={setPage}
                currentCount={txns.length}
                pageSize={pageSize}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
