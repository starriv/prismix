import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Key, Plus } from "lucide-react";
import { toast } from "sonner";

import { useApiKeys, useDeleteApiKey, useRevokeApiKey, useRotateApiKey } from "@/web/api/hooks";
import type { ApiKey, ApiKeyWithSecret } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Dialog } from "@/web/components/ui/dialog";
import { Skeleton } from "@/web/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";

import {
  ConfirmActionDialogContent,
  CreateKeyDialogContent,
  SecretDisplayDialogContent,
} from "./api-key-dialogs";
import { ApiKeyRow } from "./api-key-row";
import { AuthGuideCard } from "./auth-guide-card";

export function ApiKeysTab() {
  const { t } = useTranslation();
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
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">{t("settings.api-keys.table-empty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.api-keys.th.name")}</TableHead>
                  <TableHead>{t("settings.api-keys.th.client-id")}</TableHead>
                  <TableHead>{t("settings.api-keys.th.last-used")}</TableHead>
                  <TableHead>{t("settings.api-keys.th.status")}</TableHead>
                  <TableHead className="w-12">{t("settings.api-keys.th.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <ApiKeyRow
                    key={key.id}
                    apiKey={key}
                    onCopyClientId={handleCopyClientId}
                    onAction={setConfirmAction}
                  />
                ))}
              </TableBody>
            </Table>
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
