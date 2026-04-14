import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { Network, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { getKnownAddress } from "@/shared/tokens";
import {
  useAdminAllowedTokens,
  useAdminNetworks,
  useCreateAllowedToken,
  useDeleteAllowedToken,
  useKnownTokens,
  useUpdateAllowedToken,
} from "@/web/api/admin-hooks";
import type { AllowedToken } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { useLocaleNavigate } from "@/web/hooks/use-locale";
import { useChainRegistry } from "@/web/shared/chains";

export default function AdminTokensPage() {
  const { t } = useTranslation();
  const { data: tokens = [] } = useAdminAllowedTokens();
  const { data: networks = [] } = useAdminNetworks();
  const updateToken = useUpdateAllowedToken();
  const deleteToken = useDeleteAllowedToken();
  const [addOpen, setAddOpen] = useState(false);
  const { byNetworkId, getChainDisplayByNetworkId } = useChainRegistry();

  const enabledNetworkIds = new Set(networks.filter((n) => n.enabled).map((n) => n.networkId));

  const networkDisplayName = useCallback(
    (networkId: string): string => {
      const display = byNetworkId[networkId] ?? getChainDisplayByNetworkId(networkId);
      return display?.name ?? networkId;
    },
    [byNetworkId, getChainDisplayByNetworkId],
  );

  const isNetworkEnabled = useCallback(
    (networkId: string): boolean => {
      return enabledNetworkIds.has(networkId);
    },
    [enabledNetworkIds],
  );

  const handleToggle = useCallback(
    async (token: AllowedToken) => {
      // Block enabling token if its network is disabled
      if (!token.enabled && !isNetworkEnabled(token.network)) {
        toast.error(t("admin.tokens.toast.network-disabled"));
        return;
      }
      try {
        await updateToken.mutateAsync({ id: token.id, enabled: !token.enabled });
        toast.success(t("admin.tokens.toast.updated"));
      } catch {
        toast.error(t("admin.tokens.toast.update-error"));
      }
    },
    [updateToken, t, isNetworkEnabled],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteToken.mutateAsync(id);
        toast.success(t("admin.tokens.toast.deleted"));
      } catch {
        toast.error(t("admin.tokens.toast.delete-error"));
      }
    },
    [deleteToken, t],
  );

  const columns = useMemo<ColumnDef<AllowedToken>[]>(
    () => [
      {
        accessorKey: "symbol",
        cell: ({ row }) => (
          <DataTableBadge variant="secondary" className="font-mono">
            {row.original.symbol}
          </DataTableBadge>
        ),
        header: t("admin.tokens.th.symbol"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "network",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">
            {networkDisplayName(row.original.network)}
          </DataTableBadge>
        ),
        header: t("admin.tokens.th.network"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "contractAddress",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <DataTableText className="max-w-[200px]" mono truncate>
              {row.original.contractAddress || "-"}
            </DataTableText>
            {row.original.contractAddress &&
              getKnownAddress(row.original.symbol, row.original.network) ===
                row.original.contractAddress && (
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
              )}
          </span>
        ),
        header: t("admin.tokens.th.contract"),
        meta: { headerClassName: "w-[36%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={row.original.enabled}
              onCheckedChange={() => handleToggle(row.original)}
              disabled={!row.original.enabled && !isNetworkEnabled(row.original.network)}
            />
            {!isNetworkEnabled(row.original.network) && (
              <DataTableText className="text-[10px]" muted>
                {t("admin.tokens.network-off")}
              </DataTableText>
            )}
          </div>
        ),
        header: t("admin.tokens.th.status"),
        meta: { headerClassName: "w-[20%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-right">
            <Button variant="ghost" size="sm" onClick={() => handleDelete(row.original.id)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: { headerClassName: "w-[12%]", ...dataTableMeta.right },
      },
    ],
    [handleToggle, handleDelete, networkDisplayName, isNetworkEnabled, t],
  );

  return (
    <div>
      <Header title={t("admin.tokens.title")} description={t("admin.tokens.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("admin.tokens.title")}</CardTitle>
                <CardDescription>{t("admin.tokens.desc")}</CardDescription>
              </div>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("admin.tokens.btn.new")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={tokens}
              emptyText={t("admin.tokens.empty")}
              getRowId={(row) => String(row.id)}
              loading={false}
              showPagination={false}
              tableClassName="min-w-[900px]"
            />
          </CardContent>
        </Card>
      </div>

      <AddTokenDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// ── Add Token Dialog ─────────────────────────────────────────────

function AddTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useLocaleNavigate();
  const { data: knownTokens = [] } = useKnownTokens();
  const { data: networks = [] } = useAdminNetworks();
  const createToken = useCreateAllowedToken();

  const form = useForm({
    defaultValues: { symbol: "", network: "", contractAddress: "" },
  });

  const symbol = form.watch("symbol");
  const network = form.watch("network");
  const contractAddress = form.watch("contractAddress");

  const enabledNetworks = networks.filter((n) => n.enabled);
  const noNetworks = enabledNetworks.length === 0;

  // Auto-fill known address when symbol or network changes
  useEffect(() => {
    if (!symbol || !network) return;
    const token = knownTokens.find((t) => t.symbol === symbol);
    const addr = token?.addresses.find((a) => a.networkId === network)?.address;
    if (addr) form.setValue("contractAddress", addr);
    else form.setValue("contractAddress", "");
  }, [symbol, network, knownTokens, form]);

  // Reset on close
  useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const selectedToken = knownTokens.find((t) => t.symbol === symbol);
  const knownNetworkIds = new Set(selectedToken?.addresses.map((a) => a.networkId) ?? []);
  const hasKnownAddress = symbol && network && knownNetworkIds.has(network);

  const handleSubmit = form.handleSubmit(async (data) => {
    if (!data.symbol || !data.network || !data.contractAddress) return;
    try {
      await createToken.mutateAsync(data);
      toast.success(t("admin.tokens.toast.created"));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.tokens.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("admin.tokens.dialog-title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              {noNetworks ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Network className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground text-center">
                    {t("admin.tokens.no-networks")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      navigate("/admin/networks");
                    }}
                  >
                    {t("admin.tokens.go-networks")}
                  </Button>
                </div>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="symbol"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("admin.tokens.form.symbol")}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("admin.tokens.form.symbol-ph")} />
                          </SelectTrigger>
                          <SelectContent>
                            {knownTokens.map((token) => (
                              <SelectItem key={token.symbol} value={token.symbol}>
                                {token.symbol} — {token.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="network"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("admin.tokens.form.network")}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("admin.tokens.form.network-ph")} />
                          </SelectTrigger>
                          <SelectContent>
                            {enabledNetworks.map((net) => (
                              <SelectItem key={net.networkId} value={net.networkId}>
                                <span className="flex items-center gap-2">
                                  {net.name}
                                  {net.testnet && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                                      {t("common.testnet")}
                                    </Badge>
                                  )}
                                  {symbol && knownNetworkIds.has(net.networkId) && (
                                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                      {t("admin.tokens.form.auto-fill")}
                                    </Badge>
                                  )}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contractAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("admin.tokens.form.contract")}</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              placeholder="0x..."
                              className="font-mono text-xs pr-8"
                              disabled={!!hasKnownAddress}
                              {...field}
                            />
                          </FormControl>
                          {hasKnownAddress && (
                            <ShieldCheck className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                          )}
                        </div>
                        {hasKnownAddress && (
                          <p className="flex items-center gap-1 text-[11px] text-green-600">
                            <ShieldCheck className="h-3 w-3" />
                            {t("admin.tokens.form.verified")}
                          </p>
                        )}
                        {symbol && network && !hasKnownAddress && (
                          <p className="text-[11px] text-amber-600">
                            {t("admin.tokens.form.manual-hint")}
                          </p>
                        )}
                      </FormItem>
                    )}
                  />
                </>
              )}
            </DialogBody>
            {!noNetworks && (
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t("common.btn.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={!symbol || !network || !contractAddress || createToken.isPending}
                >
                  {t("admin.tokens.btn.create")}
                </Button>
              </DialogFooter>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
