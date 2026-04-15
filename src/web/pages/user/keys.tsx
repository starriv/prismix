import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, Key, Plus } from "lucide-react";
import { toast } from "sonner";

import type { UserKey } from "@/web/api/schemas";
import {
  useCreateUserKey,
  useDeleteUserKey,
  useDisableUserKey,
  useEnableUserKey,
  useRevealUserKey,
  useUserKeys,
} from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { DataTable } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { buildUserKeyColumns } from "./key-columns";

export default function UserKeysPage() {
  const { t } = useTranslation();
  const { data: keys = [], isLoading } = useUserKeys();
  const enableKey = useEnableUserKey();
  const disableKey = useDisableUserKey();
  const deleteKey = useDeleteUserKey();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserKey | null>(null);

  const handleOpenCreate = useCallback(() => setShowCreate(true), []);
  const handleCloseDelete = useCallback(() => setDeleteTarget(null), []);
  const handleToggle = useCallback(
    async (key: UserKey, enabled: boolean) => {
      try {
        if (enabled) {
          await enableKey.mutateAsync(key.id);
          toast.success(t("user.keys.toast.enabled"));
        } else {
          await disableKey.mutateAsync(key.id);
          toast.success(t("user.keys.toast.disabled"));
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t(enabled ? "user.keys.toast.enable-error" : "user.keys.toast.disable-error"),
        );
      }
    },
    [disableKey, enableKey, t],
  );
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    try {
      await deleteKey.mutateAsync(deleteTarget.id);
      toast.success(t("user.keys.toast.deleted"));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.keys.toast.delete-error"));
    }
  }, [deleteKey, deleteTarget, t]);

  return (
    <div>
      <Header title={t("user.keys.title")} description={t("user.keys.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Key className="h-4 w-4" />
                {t("user.keys.title")}
              </CardTitle>
              <Button size="sm" onClick={handleOpenCreate}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("user.keys.create")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <KeyTable
              keys={keys}
              loading={isLoading}
              isDeletePending={deleteKey.isPending}
              isStatusPending={enableKey.isPending || disableKey.isPending}
              onDelete={setDeleteTarget}
              onToggle={handleToggle}
            />
          </CardContent>
        </Card>

        <CreateKeyDialog open={showCreate} onOpenChange={setShowCreate} />
        <DeleteKeyDialog
          keyItem={deleteTarget}
          isPending={deleteKey.isPending}
          onConfirm={handleConfirmDelete}
          onOpenChange={handleCloseDelete}
        />
      </div>
    </div>
  );
}

// ── Create Key Dialog (two-step: form → result with copy) ────────

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createKey = useCreateUserKey();

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;
    try {
      const result = await createKey.mutateAsync({ name: name.trim() });
      setCreatedKey(result.apiKey);
      toast.success(t("user.keys.toast.created"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.keys.toast.create-error"));
    }
  }, [name, createKey, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  const handleCopy = useCallback(async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success(t("user.keys.copied"));
    setTimeout(() => setCopied(false), 2000);
  }, [createdKey, t]);

  const handleClose = useCallback(() => {
    setName("");
    setCreatedKey(null);
    setCopied(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Step 2: Show created key with copy
  if (createdKey) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent preventClose>
          <DialogHeader>
            <DialogTitle>{t("user.keys.created-notice")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("user.keys.created-warning")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                {createdKey}
              </code>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={handleClose}>{t("user.keys.dismiss")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step 1: Name input form
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.keys.create-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-4">
            <div className="space-y-2">
              <Label>{t("user.keys.name-label")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("user.keys.name-ph")}
                autoFocus
              />
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || createKey.isPending}>
            {createKey.isPending ? t("common.btn.creating") : t("user.keys.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteKeyDialog({
  keyItem,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  keyItem: UserKey | null;
  isPending: boolean;
  onConfirm: () => Promise<void>;
  onOpenChange: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={!!keyItem} onOpenChange={(open) => !open && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("user.keys.dialog.delete.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("user.keys.dialog.delete.body")}</p>
          {keyItem ? (
            <div className="rounded-lg border bg-muted/50 px-3 py-2">
              <p className="text-sm font-medium">{keyItem.name}</p>
              <p className="text-xs text-muted-foreground">{keyItem.apiKeyPrefix}...</p>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange} disabled={isPending}>
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={isPending}>
            {t("user.keys.action.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Key Table with copy / disable / delete ──────────────────────────

function KeyTable({
  keys,
  loading,
  isDeletePending,
  isStatusPending,
  onDelete,
  onToggle,
}: {
  keys: UserKey[];
  loading: boolean;
  isDeletePending: boolean;
  isStatusPending: boolean;
  onDelete: (key: UserKey) => void;
  onToggle: (key: UserKey, enabled: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const revealKey = useRevealUserKey();

  const handleCopy = useCallback(
    async (id: number) => {
      try {
        const { apiKey } = await revealKey.mutateAsync(id);
        await navigator.clipboard.writeText(apiKey);
        toast.success(t("user.keys.copied"));
      } catch {
        toast.error(t("user.keys.toast.copy-error"));
      }
    },
    [revealKey, t],
  );
  const handleDelete = useCallback((key: UserKey) => onDelete(key), [onDelete]);
  const columns = useMemo(
    () =>
      buildUserKeyColumns({
        handleCopy,
        handleDelete,
        handleToggle: onToggle,
        isCopyPending: revealKey.isPending,
        isStatusPending: isStatusPending || isDeletePending,
        language: i18n.language,
        t,
      }),
    [
      handleCopy,
      handleDelete,
      i18n.language,
      isDeletePending,
      isStatusPending,
      onToggle,
      revealKey.isPending,
      t,
    ],
  );

  return (
    <DataTable
      columns={columns}
      data={keys}
      emptyText={t("user.keys.empty")}
      loading={loading}
      tableClassName="min-w-[720px]"
    />
  );
}
