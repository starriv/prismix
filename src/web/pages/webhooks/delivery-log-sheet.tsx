import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useRetryWebhookDelivery, useWebhookDeliveries } from "@/web/api/hooks";
import type { WebhookDelivery, WebhookEndpoint } from "@/web/api/schemas";
import {
  DataTable,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";

import { DeliveryStatusBadge } from "./webhook-helpers";

// ── Delivery Log Sheet ───────────────────────────────────────────────

interface DeliveryLogSheetProps {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
  locale: string;
}

export function DeliveryLogSheet({ endpoint, onClose, locale }: DeliveryLogSheetProps) {
  const { t } = useTranslation();

  return (
    <Sheet open={!!endpoint} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:w-[520px]">
        <SheetHeader>
          <SheetTitle>{t("webhook.deliveries.title")}</SheetTitle>
          {endpoint && (
            <p className="truncate font-mono text-xs text-muted-foreground">{endpoint.url}</p>
          )}
        </SheetHeader>
        <SheetBody>
          {endpoint ? <DeliveryLogSheetContent endpoint={endpoint} locale={locale} /> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function DeliveryLogSheetContent({
  endpoint,
  locale,
}: {
  endpoint: WebhookEndpoint;
  locale: string;
}) {
  const { t } = useTranslation();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const { data, isLoading } = useWebhookDeliveries(endpoint.id, pagination.pageIndex);
  const retryDelivery = useRetryWebhookDelivery();

  const deliveries = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleRetry = useCallback(
    async (delivery: WebhookDelivery) => {
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

  const columns = useMemo<ColumnDef<WebhookDelivery>[]>(
    () => [
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={locale} value={row.original.createdAt} />
        ),
        header: t("webhook.deliveries.th.time"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "eventType",
        cell: ({ row }) => <DataTableText mono>{row.original.eventType}</DataTableText>,
        header: t("webhook.deliveries.th.event"),
        meta: { headerClassName: "w-[20%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => <DeliveryStatusBadge status={row.original.status} t={t} />,
        header: t("webhook.deliveries.th.status"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "latencyMs",
        cell: ({ row }) => (
          <DataTableText muted>
            {row.original.latencyMs != null ? `${row.original.latencyMs}ms` : "-"}
          </DataTableText>
        ),
        header: t("webhook.deliveries.th.latency"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "attempts",
        cell: ({ row }) => <DataTableText>{row.original.attempts}</DataTableText>,
        header: t("webhook.deliveries.th.attempts"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-right">
            {row.original.status === "failed" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={retryDelivery.isPending}
                onClick={() => void handleRetry(row.original)}
                aria-label={t("common.a11y.refresh")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
        enableHiding: false,
        header: t("webhook.deliveries.th.actions"),
        meta: { headerClassName: "w-[20%]", ...dataTableMeta.right },
      },
    ],
    [locale, handleRetry, retryDelivery.isPending, t],
  );

  if (isLoading && deliveries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="animate-spin">
          <Loader2 className="h-5 w-5 text-muted-foreground" />
        </span>
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={deliveries}
      emptyText={t("webhook.deliveries.empty")}
      getRowId={(row) => String(row.id)}
      loading={isLoading}
      manualPagination
      onPaginationChange={setPagination}
      pagination={pagination}
      rowCount={total}
      tableClassName="min-w-[760px]"
    />
  );
}
