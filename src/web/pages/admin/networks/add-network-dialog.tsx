import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { useCircleNetworks, useCreateNetwork } from "@/web/api/admin-hooks";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";

import { ChainEntryList } from "./chain-entry-list";

export function AddNetworkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: circleNetworks = [], isLoading } = useCircleNetworks();
  const createNetwork = useCreateNetwork();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const available = circleNetworks.filter((c) => !c.alreadyAdded);
  const mainnets = available.filter((c) => !c.testnet);
  const testnets = available.filter((c) => c.testnet);

  const toggle = useCallback((chainId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  }, []);

  const handleConfirm = async () => {
    const entries = available.filter((c) => selected.has(c.chainId));
    if (entries.length === 0) return;

    setSubmitting(true);
    let addedCount = 0;
    try {
      for (const entry of entries) {
        await createNetwork.mutateAsync({
          chainId: entry.chainId,
          networkId: `eip155:${entry.chainId}`,
          name: entry.name,
          shortName: entry.shortName,
          explorerUrl: entry.explorerUrl,
          testnet: entry.testnet,
          iconUrl: entry.iconUrl,
        });
        addedCount++;
      }
      toast.success(t("admin.networks.toast.batch-added", { count: addedCount }));
      setSelected(new Set());
      onOpenChange(false);
    } catch (err) {
      if (addedCount > 0) {
        toast.success(t("admin.networks.toast.batch-added", { count: addedCount }));
      }
      toast.error(err instanceof Error ? err.message : t("admin.networks.toast.add-error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) setSelected(new Set());
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("admin.networks.add-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="animate-spin">
                <Loader2 className="h-5 w-5 text-muted-foreground" />
              </span>
            </div>
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("admin.networks.all-added")}
            </p>
          ) : (
            <Tabs defaultValue="mainnet">
              <TabsList className="w-full mb-3">
                <TabsTrigger value="mainnet" className="flex-1">
                  {t("common.mainnet")} ({mainnets.length})
                </TabsTrigger>
                <TabsTrigger value="testnet" className="flex-1">
                  {t("common.testnet")} ({testnets.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="mainnet">
                <ChainEntryList entries={mainnets} selected={selected} onToggle={toggle} />
              </TabsContent>
              <TabsContent value="testnet">
                <ChainEntryList entries={testnets} selected={selected} onToggle={toggle} />
              </TabsContent>
            </Tabs>
          )}
        </DialogBody>
        {selected.size > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(new Set())} disabled={submitting}>
              {t("admin.networks.btn.clear")}
            </Button>
            <Button onClick={handleConfirm} disabled={submitting}>
              {submitting ? (
                <span className="animate-spin">
                  <Loader2 className="h-4 w-4 mr-2" />
                </span>
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {t("admin.networks.btn.confirm-add", { count: selected.size })}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
