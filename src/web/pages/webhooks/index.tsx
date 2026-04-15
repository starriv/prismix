import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, MoreHorizontal, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useTestWebhook, useWebhookEvents, useWebhooks } from "@/web/api/hooks";
import type { WebhookEndpoint } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";

import { CreateWebhookDialog } from "./create-webhook-dialog";
import { DeliveryLogSheet } from "./delivery-log-sheet";
import { EditWebhookDialog } from "./edit-webhook-dialog";
import {
  DeleteConfirmDialog,
  EndpointStatusBadge,
  RotateConfirmDialog,
  SecretDisplayDialog,
} from "./webhook-helpers";

// ── Page ────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const { t, i18n } = useTranslation();
  const { data: endpoints = [], isLoading } = useWebhooks();
  const { data: eventsData } = useWebhookEvents();
  const testWebhook = useTestWebhook();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null);
  const [rotateTarget, setRotateTarget] = useState<WebhookEndpoint | null>(null);
  const [secretEndpoint, setSecretEndpoint] = useState<WebhookEndpoint | null>(null);
  const [deliveriesEndpoint, setDeliveriesEndpoint] = useState<WebhookEndpoint | null>(null);

  const handleCreateSuccess = useCallback((created: WebhookEndpoint) => {
    setCreateOpen(false);
    setSecretEndpoint(created);
  }, []);

  const handleTest = useCallback(
    async (id: number) => {
      try {
        const result = await testWebhook.mutateAsync(id);
        if (result.success) {
          toast.success(t("webhook.toast.test-ok"));
        } else {
          toast.error(t("webhook.toast.test-fail"));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("webhook.toast.test-fail"));
      }
    },
    [testWebhook, t],
  );
  const columns = useMemo<ColumnDef<WebhookEndpoint>[]>(
    () => [
      {
        accessorKey: "url",
        cell: ({ row }) => (
          <DataTableText className="max-w-[280px]" mono truncate>
            {row.original.url}
          </DataTableText>
        ),
        header: t("webhook.form.url"),
        meta: { headerClassName: "w-[30%]" },
      },
      {
        accessorKey: "description",
        cell: ({ row }) => (
          <DataTableText className="max-w-[200px]" truncate>
            {row.original.description || "-"}
          </DataTableText>
        ),
        header: t("webhook.form.description"),
        meta: { headerClassName: "w-[24%]" },
      },
      {
        accessorKey: "events",
        cell: ({ row }) => (
          <DataTableBadge variant="secondary">{row.original.events.length}</DataTableBadge>
        ),
        header: t("webhook.card.events"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => <EndpointStatusBadge status={row.original.status} t={t} />,
        header: t("webhook.card.status"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t("common.a11y.actions")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void handleTest(row.original.id)}>
                  <Send className="mr-2 h-3.5 w-3.5" />
                  {t("webhook.btn.test")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeliveriesEndpoint(row.original)}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  {t("webhook.deliveries.title")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setEditing(row.original)}>
                  {t("webhook.dialog-title-edit")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRotateTarget(row.original)}>
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  {t("webhook.btn.rotate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteTarget(row.original)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {t("webhook.btn.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        enableHiding: false,
        header: t("common.th.actions"),
        meta: { headerClassName: "w-[14%]", ...dataTableMeta.right },
      },
    ],
    [handleTest, t],
  );

  return (
    <div>
      <Header title={t("webhook.title")} description={t("webhook.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("webhook.btn.add")}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={endpoints}
          emptyText={t("webhook.table-empty")}
          getRowId={(row) => String(row.id)}
          loading={isLoading}
          showPagination={false}
          tableClassName="min-w-[900px]"
        />
      </div>

      {/* Create dialog */}
      <CreateWebhookDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        groups={eventsData?.groups ?? []}
        onSuccess={handleCreateSuccess}
      />

      {/* Edit dialog */}
      {editing && (
        <EditWebhookDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          endpoint={editing}
          groups={eventsData?.groups ?? []}
        />
      )}

      {/* Secret display */}
      <SecretDisplayDialog endpoint={secretEndpoint} onClose={() => setSecretEndpoint(null)} />

      {/* Delete confirm */}
      <DeleteConfirmDialog endpoint={deleteTarget} onClose={() => setDeleteTarget(null)} />

      {/* Rotate confirm */}
      <RotateConfirmDialog
        endpoint={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onRotated={setSecretEndpoint}
      />

      {/* Delivery log sheet */}
      <DeliveryLogSheet
        endpoint={deliveriesEndpoint}
        onClose={() => setDeliveriesEndpoint(null)}
        locale={i18n.language}
      />
    </div>
  );
}
