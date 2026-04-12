import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExternalLink, Loader2, MoreHorizontal, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useTestWebhook, useWebhookEvents, useWebhooks } from "@/web/api/hooks";
import type { WebhookEndpoint } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

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

        <Card>
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <span className="animate-spin">
                  <Loader2 className="h-5 w-5 text-muted-foreground" />
                </span>
              </div>
            ) : endpoints.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("webhook.table-empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("webhook.form.url")}</TableHead>
                    <TableHead>{t("webhook.form.description")}</TableHead>
                    <TableHead>{t("webhook.card.events")}</TableHead>
                    <TableHead>{t("webhook.card.status")}</TableHead>
                    <TableHead className="text-right">{t("common.th.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell className="font-mono text-xs max-w-[280px] truncate">
                        {ep.url}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {ep.description || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{ep.events.length}</Badge>
                      </TableCell>
                      <TableCell>
                        <EndpointStatusBadge status={ep.status} t={t} />
                      </TableCell>
                      <TableCell className="text-right">
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
                            <DropdownMenuItem onClick={() => handleTest(ep.id)}>
                              <Send className="h-3.5 w-3.5 mr-2" />
                              {t("webhook.btn.test")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeliveriesEndpoint(ep)}>
                              <ExternalLink className="h-3.5 w-3.5 mr-2" />
                              {t("webhook.deliveries.title")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setEditing(ep)}>
                              {t("webhook.dialog-title-edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setRotateTarget(ep)}>
                              <RotateCcw className="h-3.5 w-3.5 mr-2" />
                              {t("webhook.btn.rotate")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteTarget(ep)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              {t("webhook.btn.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
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
