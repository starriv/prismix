import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { groupBy, orderBy } from "lodash-es";
import { Key, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  useAiKeys,
  useAiProviders,
  useDeleteAiKey,
  useKeyProviders,
  useTestAiKey,
  useUpdateAiKey,
  useUpdateAiProvider,
} from "@/web/api/hooks";
import type { AiKey, AiProvider } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import { AddKeyDialog } from "./add-key-dialog";
import { DeleteKeyDialog } from "./delete-key-dialog";
import { ProviderPoolCard } from "./provider-pool-card";

export default function AiKeysPage() {
  const { t } = useTranslation();
  const { data: keys = [], isLoading } = useAiKeys();
  const { data: providers = [] } = useAiProviders();
  const { data: keyProviders = [] } = useKeyProviders();
  const updateKey = useUpdateAiKey();
  const updateProvider = useUpdateAiProvider();
  const deleteKey = useDeleteAiKey();
  const testKey = useTestAiKey();

  const [addOpen, setAddOpen] = useState(false);
  const [addProviderId, setAddProviderId] = useState<number>(0);
  const [deleteTarget, setDeleteTarget] = useState<AiKey | null>(null);

  const providerGroups = useMemo(() => {
    const grouped = groupBy(keys, "providerId");
    const providerMap = new Map(providers.map((p) => [p.id, p]));

    return orderBy(
      Object.entries(grouped).map(([pid, poolKeys]) => ({
        providerId: Number(pid),
        provider: providerMap.get(Number(pid)),
        keys: orderBy(poolKeys, [(k) => k.lastUsedAt ?? ""], ["asc"]),
      })),
      [(g) => g.provider?.name ?? ""],
      ["asc"],
    );
  }, [keys, providers]);

  const getNextKeyId = useCallback((poolKeys: AiKey[]): number | null => {
    const enabled = poolKeys.filter((k) => k.enabled);
    if (enabled.length === 0) return null;
    const sorted = orderBy(enabled, [(k) => k.lastUsedAt ?? ""], ["asc"]);
    return sorted[0].id;
  }, []);

  const handleToggle = useCallback(
    async (key: AiKey) => {
      try {
        await updateKey.mutateAsync({ id: key.id, enabled: !key.enabled });
        toast.success(t("ai.toast.updated"));
      } catch {
        toast.error(t("ai.toast.update-error"));
      }
    },
    [updateKey, t],
  );

  const handleTest = useCallback(
    async (key: AiKey) => {
      try {
        const result = await testKey.mutateAsync(key.id);
        if (result.success) {
          toast.success(t("ai.toast.test-ok", { ms: result.latencyMs ?? 0 }));
        } else {
          toast.error(result.error ?? t("ai.toast.test-error"));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("ai.toast.test-error"));
      }
    },
    [testKey, t],
  );

  const handleDelete = useCallback((key: AiKey) => {
    setDeleteTarget(key);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteKey.mutateAsync(deleteTarget.id);
      toast.success(t("ai.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("ai.toast.delete-error"));
    }
  }, [deleteTarget, deleteKey, t]);

  const handleWeightChange = useCallback(
    async (key: AiKey, delta: number) => {
      const newWeight = Math.max(0, Math.min(100, (key.weight ?? 1) + delta));
      if (newWeight === key.weight) return;
      try {
        await updateKey.mutateAsync({ id: key.id, weight: newWeight });
      } catch {
        toast.error(t("ai.toast.update-error"));
      }
    },
    [updateKey, t],
  );

  const handleStrategyChange = useCallback(
    async (provider: AiProvider, strategy: string) => {
      try {
        await updateProvider.mutateAsync({ id: provider.id, loadBalanceStrategy: strategy });
        toast.success(t("ai.toast.updated"));
      } catch {
        toast.error(t("ai.toast.update-error"));
      }
    },
    [updateProvider, t],
  );

  const handleAddToProvider = useCallback((providerId: number) => {
    setAddProviderId(providerId);
    setAddOpen(true);
  }, []);

  const handleUpstreamChange = useCallback(
    async (key: AiKey, upstreamId: number | null) => {
      if ((key.upstreamId ?? null) === upstreamId) return;
      try {
        await updateKey.mutateAsync({ id: key.id, upstreamId });
        toast.success(t("ai.toast.updated"));
      } catch {
        toast.error(t("ai.toast.update-error"));
      }
    },
    [t, updateKey],
  );

  const handleAddGlobal = useCallback(() => {
    setAddProviderId(0);
    setAddOpen(true);
  }, []);

  return (
    <div>
      <Header title={t("ai.title")} description={t("ai.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={handleAddGlobal}>
            <Plus className="h-4 w-4 mr-1" />
            {t("ai.btn.new")}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center space-y-2">
                <Key className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">{t("ai.empty")}</p>
                <p className="text-xs text-muted-foreground">{t("ai.empty-hint")}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {providerGroups.map((group) => {
              const enabledCount = group.keys.filter((k) => k.enabled).length;
              const nextId = getNextKeyId(group.keys);

              return (
                <ProviderPoolCard
                  key={group.providerId}
                  provider={group.provider}
                  providerName={group.provider?.name ?? t("ai.unknown-provider")}
                  keys={group.keys}
                  enabledCount={enabledCount}
                  totalCount={group.keys.length}
                  nextKeyId={nextId}
                  onToggle={handleToggle}
                  onTest={handleTest}
                  onDelete={handleDelete}
                  onWeightChange={handleWeightChange}
                  onStrategyChange={handleStrategyChange}
                  onUpstreamChange={handleUpstreamChange}
                  onAdd={() => handleAddToProvider(group.providerId)}
                  isToggling={updateKey.isPending}
                  isTesting={testKey.isPending}
                  t={t}
                />
              );
            })}
          </div>
        )}
      </div>

      <AddKeyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        providers={providers}
        keyProviders={keyProviders}
        defaultProviderId={addProviderId}
      />

      <DeleteKeyDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        keyName={deleteTarget?.name ?? ""}
        onConfirm={handleConfirmDelete}
        isPending={deleteKey.isPending}
      />
    </div>
  );
}
