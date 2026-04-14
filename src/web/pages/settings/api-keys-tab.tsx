import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Key, MoreHorizontal, Plus, RotateCw, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useApiKeys, useDeleteApiKey, useRevokeApiKey, useRotateApiKey } from "@/web/api/hooks";
import type { ApiKey, ApiKeyWithSecret } from "@/web/api/schemas";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Dialog } from "@/web/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";

import {
  ConfirmActionDialogContent,
  CreateKeyDialogContent,
  SecretDisplayDialogContent,
} from "./api-key-dialogs";
import { AuthGuideCard } from "./auth-guide-card";

export function ApiKeysTab() {
  const { t, i18n } = useTranslation();
  const { data: apiKeys = [], isLoading } = useApiKeys();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyWithSecret | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "revoke" | "rotate" | "delete";
    key: ApiKey;
  } | null>(null);

  const revokeApiKey = useRevokeApiKey();
  const rotateApiKey = useRotateApiKey();
  const deleteApiKey = useDeleteApiKey();

  const handleCreateSuccess = useCallback((key: ApiKeyWithSecret) => {
    setCreateOpen(false);
    setCreatedKey(key);
  }, []);

  const handleCloseSecret = useCallback(() => {
    setCreatedKey(null);
  }, []);

  const handleCopyClientId = useCallback(
    (clientId: string) => {
      navigator.clipboard.writeText(clientId);
      toast.success(t("settings.api-keys.toast.copied"));
    },
    [t],
  );

  const handleConfirmAction = useCallback(async () => {
    if (!confirmAction) return;
    const { type, key } = confirmAction;
    try {
      if (type === "revoke") {
        await revokeApiKey.mutateAsync(key.id);
        toast.success(t("settings.api-keys.toast.revoked"));
      } else if (type === "rotate") {
        const rotated = await rotateApiKey.mutateAsync(key.id);
        toast.success(t("settings.api-keys.toast.rotated"));
        setConfirmAction(null);
        setCreatedKey(rotated);
        return;
      } else if (type === "delete") {
        await deleteApiKey.mutateAsync(key.id);
        toast.success(t("settings.api-keys.toast.deleted"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    }
    setConfirmAction(null);
  }, [confirmAction, revokeApiKey, rotateApiKey, deleteApiKey, t]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmAction(null);
  }, []);

  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleCloseCreate = useCallback((open: boolean) => {
    if (!open) setCreateOpen(false);
  }, []);

  const isPending = revokeApiKey.isPending || rotateApiKey.isPending || deleteApiKey.isPending;
  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("settings.api-keys.th.name"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "clientId",
        cell: ({ row }) => (
          <DataTableText mono muted>
            {row.original.clientId}
          </DataTableText>
        ),
        header: t("settings.api-keys.th.client-id"),
        meta: { headerClassName: "w-[28%]" },
      },
      {
        accessorKey: "lastUsedAt",
        cell: ({ row }) =>
          row.original.lastUsedAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.lastUsedAt} muted />
          ) : (
            <DataTableText muted nowrap>
              {t("settings.api-keys.never-used")}
            </DataTableText>
          ),
        header: t("settings.api-keys.th.last-used"),
        meta: { headerClassName: "w-[20%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => (
          <DataTableBadge variant={row.original.status === "active" ? "default" : "destructive"}>
            {row.original.status === "active"
              ? t("common.status.active")
              : t("common.status.disabled")}
          </DataTableBadge>
        ),
        header: t("settings.api-keys.th.status"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const isActive = row.original.status === "active";
          return (
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
                  {isActive && (
                    <>
                      <DropdownMenuItem onClick={() => handleCopyClientId(row.original.clientId)}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        {t("settings.api-keys.action.copy-id")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setConfirmAction({ type: "rotate", key: row.original })}
                      >
                        <RotateCw className="mr-2 h-3.5 w-3.5" />
                        {t("settings.api-keys.action.rotate")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setConfirmAction({ type: "revoke", key: row.original })}
                        className="text-destructive"
                      >
                        <ShieldOff className="mr-2 h-3.5 w-3.5" />
                        {t("settings.api-keys.action.revoke")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    onClick={() => setConfirmAction({ type: "delete", key: row.original })}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {t("settings.api-keys.action.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
        enableHiding: false,
        header: t("settings.api-keys.th.actions"),
        meta: { headerClassName: "w-[16%]", ...dataTableMeta.right },
      },
    ],
    [handleCopyClientId, t],
  );

  return (
    <div className="mt-4 space-y-4">
      {/* Auth Guide — collapsible reference card */}
      <AuthGuideCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              {t("settings.api-keys.title")}
            </CardTitle>
            <CardDescription>{t("settings.api-keys.desc")}</CardDescription>
          </div>
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("settings.api-keys.btn.create")}
          </Button>
        </CardHeader>
        <CardContent>
          {!isLoading && apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">{t("settings.api-keys.table-empty")}</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={apiKeys}
              emptyText={t("settings.api-keys.table-empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              showPagination={false}
              tableClassName="min-w-[900px]"
            />
          )}
        </CardContent>
      </Card>

      {/* Create Key Dialog */}
      <Dialog open={createOpen} onOpenChange={handleCloseCreate}>
        <CreateKeyDialogContent onSuccess={handleCreateSuccess} />
      </Dialog>

      {/* Secret Display Dialog */}
      <Dialog open={!!createdKey} onOpenChange={handleCloseSecret}>
        {createdKey && (
          <SecretDisplayDialogContent apiKey={createdKey} onClose={handleCloseSecret} />
        )}
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmAction} onOpenChange={handleCancelConfirm}>
        {confirmAction && (
          <ConfirmActionDialogContent
            type={confirmAction.type}
            keyName={confirmAction.key.name}
            isPending={isPending}
            onConfirm={handleConfirmAction}
            onCancel={handleCancelConfirm}
          />
        )}
      </Dialog>
    </div>
  );
}
