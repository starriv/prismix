import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useRetryWebhookDelivery, useWebhookDeliveries } from "@/web/api/hooks";
import type { WebhookDelivery, WebhookEndpoint } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { getDateLocale } from "@/web/shared/date-locale";

import { DeliveryStatusBadge } from "./webhook-helpers";

// ── Delivery Log Sheet ───────────────────────────────────────────────

interface DeliveryLogSheetProps {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
  locale: string;
}

export function DeliveryLogSheet({ endpoint, onClose, locale }: DeliveryLogSheetProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const { data, isLoading } = useWebhookDeliveries(endpoint?.id ?? null, page);
  const retryDelivery = useRetryWebhookDelivery();

  const deliveries = data?.items ?? [];
  const total = data?.total ?? 0;

  // Reset page when endpoint changes
  useEffect(() => {
    setPage(0);
  }, [endpoint?.id]);

  const handleRetry = useCallback(
    async (delivery: WebhookDelivery) => {
      if (!endpoint) return;
      try {
        await retryDelivery.mutateAsync({
          endpointId: endpoint.id,
          deliveryId: delivery.id,
        });
        toast.success(t("webhook.toast.retry-ok"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("webhook.toast.retry-fail"));
      }
    },
    [endpoint, retryDelivery, t],
  );

  const handlePrev = useCallback(() => {
    setPage((p) => Math.max(0, p - 1));
  }, []);

  const handleNext = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  return (
    <Sheet open={!!endpoint} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:w-[520px]">
        <SheetHeader>
          <SheetTitle>{t("webhook.deliveries.title")}</SheetTitle>
          {endpoint && (
            <p className="text-xs font-mono text-muted-foreground truncate">{endpoint.url}</p>
          )}
        </SheetHeader>
        <SheetBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="animate-spin">
                <Loader2 className="h-5 w-5 text-muted-foreground" />
              </span>
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("webhook.deliveries.empty")}
            </p>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("webhook.deliveries.th.time")}</TableHead>
                    <TableHead>{t("webhook.deliveries.th.event")}</TableHead>
                    <TableHead>{t("webhook.deliveries.th.status")}</TableHead>
                    <TableHead>{t("webhook.deliveries.th.latency")}</TableHead>
                    <TableHead>{t("webhook.deliveries.th.attempts")}</TableHead>
                    <TableHead>{t("webhook.deliveries.th.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(d.createdAt), {
                          addSuffix: true,
                          locale: getDateLocale(locale),
                        })}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{d.eventType}</TableCell>
                      <TableCell>
                        <DeliveryStatusBadge status={d.status} t={t} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.latencyMs != null ? `${d.latencyMs}ms` : "-"}
                      </TableCell>
                      <TableCell className="text-xs">{d.attempts}</TableCell>
                      <TableCell>
                        {d.status === "failed" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={retryDelivery.isPending}
                            onClick={() => handleRetry(d)}
                            aria-label={t("common.a11y.refresh")}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {(page > 0 || deliveries.length === DEFAULT_PAGE_SIZE) && (
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={handlePrev}>
                    {t("common.pagination.prev")}
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("common.pagination.page", { page: page + 1 })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deliveries.length < DEFAULT_PAGE_SIZE}
                    onClick={handleNext}
                  >
                    {t("common.pagination.next")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
