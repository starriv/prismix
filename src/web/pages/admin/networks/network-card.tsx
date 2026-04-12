import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useDeleteNetwork, useUpdateNetwork } from "@/web/api/admin-hooks";
import type { SupportedNetwork } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Switch } from "@/web/components/ui/switch";

import { ChainIcon } from "./chain-icon";

export function NetworkCard({
  network,
  tokenSymbols,
}: {
  network: SupportedNetwork;
  tokenSymbols: string[];
}) {
  const { t } = useTranslation();
  const updateNetwork = useUpdateNetwork();
  const deleteNetwork = useDeleteNetwork();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingRpc, setEditingRpc] = useState(false);
  const [rpcDraft, setRpcDraft] = useState("");

  const handleRpcChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRpcDraft(e.target.value),
    [],
  );

  const handleRpcSave = useCallback(async () => {
    const trimmed = rpcDraft.trim();
    if (trimmed === network.rpcUrl) {
      setEditingRpc(false);
      return;
    }
    try {
      await updateNetwork.mutateAsync({ id: network.id, rpcUrl: trimmed });
      toast.success(t("admin.networks.toast.rpc-updated"));
      setEditingRpc(false);
    } catch {
      toast.error(t("admin.networks.toast.rpc-error"));
    }
  }, [rpcDraft, network.rpcUrl, network.id, updateNetwork, t]);

  const handleRpcKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleRpcSave();
      if (e.key === "Escape") {
        setRpcDraft(network.rpcUrl);
        setEditingRpc(false);
      }
    },
    [handleRpcSave, network.rpcUrl],
  );

  const doToggle = async () => {
    try {
      await updateNetwork.mutateAsync({ id: network.id, enabled: !network.enabled });
      toast.success(
        network.enabled ? t("admin.networks.toast.disabled") : t("admin.networks.toast.enabled"),
      );
    } catch {
      toast.error(t("admin.networks.toast.toggle-error"));
    }
  };

  const handleToggle = () => {
    doToggle();
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteNetwork.mutateAsync(network.id);
      toast.success(t("admin.networks.toast.removed"));
    } catch {
      toast.error(t("admin.networks.toast.remove-error"));
    }
  };

  return (
    <div className="group relative rounded-xl border bg-card p-5 transition-all hover:shadow-md">
      {/* Top: icon + name + switch */}
      <div className="flex items-start gap-3.5">
        <ChainIcon src={network.iconUrl} name={network.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{network.name}</h3>
            {network.testnet && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                {t("common.testnet")}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">Chain {network.chainId}</p>
        </div>
        <Switch
          checked={network.enabled}
          onCheckedChange={handleToggle}
          disabled={updateNetwork.isPending}
        />
      </div>

      {/* Middle: metadata */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Network ID</span>
          <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">
            {network.networkId}
          </code>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Explorer</span>
          <a
            href={network.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-500 hover:underline flex items-center gap-1"
          >
            {network.explorerUrl.replace("https://", "")}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">RPC URL</span>
          {editingRpc ? (
            <div className="flex items-center gap-1 max-w-[60%]">
              <Input
                value={rpcDraft}
                onChange={handleRpcChange}
                onKeyDown={handleRpcKeyDown}
                onBlur={handleRpcSave}
                className="h-6 text-[11px] font-mono px-1.5"
                placeholder={t("admin.networks.rpc-url-ph")}
                autoFocus
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setRpcDraft(network.rpcUrl);
                setEditingRpc(true);
              }}
              className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors max-w-[60%]"
            >
              <span className="truncate">{network.rpcUrl || t("admin.networks.rpc-url-ph")}</span>
              <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
        {tokenSymbols.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{t("common.th.token")}</span>
            <div className="flex gap-1">
              {tokenSymbols.map((sym) => (
                <Badge key={sym} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {sym}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer: delete */}
      <div className="mt-4 pt-3 border-t">
        {confirmDelete && (
          <p className="text-xs text-destructive mb-2">{t("admin.networks.delete-confirm")}</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
          onClick={handleDelete}
          disabled={deleteNetwork.isPending}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          {confirmDelete ? t("admin.networks.btn.confirm-delete") : t("admin.networks.btn.remove")}
        </Button>
      </div>
    </div>
  );
}
