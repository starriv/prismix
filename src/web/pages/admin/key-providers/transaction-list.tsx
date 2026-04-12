import { useState } from "react";
import { useTranslation } from "react-i18next";

import { KeyRound } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { useKeyProviderTxns } from "@/web/api/hooks";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { cn } from "@/web/shared/utils";

import { PREVIEW_COUNT } from "./constants";

export function TransactionList({ providerId }: { providerId: number }) {
  const { t } = useTranslation();
  const { data: txns = [] } = useKeyProviderTxns(providerId);
  const [expanded, setExpanded] = useState(false);
  const displayTxns = expanded ? txns : txns.slice(0, PREVIEW_COUNT);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{t("admin.key-providers.detail.txns")}</CardTitle>
          {txns.length > 0 && (
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
            <div className={cn("space-y-2", expanded && "max-h-80 overflow-y-auto pr-1")}>
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
                  {tx.description && (
                    <p className="text-xs text-muted-foreground pl-10 break-all">
                      {tx.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {txns.length > PREVIEW_COUNT && (
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
