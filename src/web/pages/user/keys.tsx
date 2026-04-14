import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, Key, Plus } from "lucide-react";
import { toast } from "sonner";

import type { UserKey } from "@/web/api/schemas";
import { useCreateUserKey, useRevealUserKey, useUserKeys } from "@/web/api/user-hooks";
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
import { buildKeyStatusColorMap } from "./table-helpers";

export default function UserKeysPage() {
  const { t } = useTranslation();
  const { data: keys = [], isLoading } = useUserKeys();
  const [showCreate, setShowCreate] = useState(false);

  const handleOpenCreate = useCallback(() => setShowCreate(true), []);

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
            <KeyTable keys={keys} loading={isLoading} />
          </CardContent>
        </Card>

        <CreateKeyDialog open={showCreate} onOpenChange={setShowCreate} />
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

// ── Key Table with copy ──────────────────────────────────────────

function KeyTable({ keys, loading }: { keys: UserKey[]; loading: boolean }) {
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
  const keyStatusColorMap = useMemo(() => buildKeyStatusColorMap(t), [t]);
  const columns = useMemo(
    () =>
      buildUserKeyColumns({
        handleCopy,
        isCopyPending: revealKey.isPending,
        keyStatusColorMap,
        language: i18n.language,
        t,
      }),
    [handleCopy, i18n.language, keyStatusColorMap, revealKey.isPending, t],
  );

  return (
    <DataTable
      columns={columns}
      data={keys}
      emptyText={t("user.keys.empty")}
      loading={loading}
      tableClassName="min-w-[620px]"
    />
  );
}
