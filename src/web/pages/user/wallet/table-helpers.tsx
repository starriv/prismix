import type { TFunction } from "i18next";
import { ExternalLink } from "lucide-react";
import { match } from "ts-pattern";

import { removeTailingZero } from "@/shared/number";
import type { UserWalletTopupOrder } from "@/web/api/schemas";
import type { StatusBadgeColorMap } from "@/web/components/dashboard/status-badge";
import { DataTableBadge, DataTableText } from "@/web/components/data-table";
import { type ChainDisplay, explorerTxUrl } from "@/web/shared/chains";

type GetChainDisplayByNetworkId = (networkId: string) => ChainDisplay | undefined;

export const walletStatusClassNames = {
  danger: "border-red-500/30 bg-red-500/10 text-red-600",
  neutral: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600",
  success: "border-green-500/30 bg-green-500/10 text-green-600",
  warning: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
} as const;

export function buildStatusColorMap(
  t: TFunction,
  translationPrefix: string,
  classNames: Record<string, string>,
): StatusBadgeColorMap {
  return Object.fromEntries(
    Object.entries(classNames).map(([key, className]) => [
      key,
      { label: t(`${translationPrefix}.${key}`), className },
    ]),
  );
}

export function formatWalletTopupOrderAmount(order: UserWalletTopupOrder) {
  if (order.type === "fiat" && order.status !== "confirmed") {
    const fiatAmount = order.fiatAmount || order.amount;
    return `${removeTailingZero(fiatAmount)} ${order.fiatCurrency}`;
  }

  return `$${removeTailingZero(order.amount)} USDC`;
}

export function WalletSourceBadge({ source, t }: { source: string; t: TFunction }) {
  return (
    <DataTableBadge variant="outline">
      {source === "on_chain"
        ? t("user.wallet.source.on_chain", "On-chain")
        : t("user.wallet.source.platform", "Platform")}
    </DataTableBadge>
  );
}

export function WalletTransactionTypeBadge({ type, t }: { type: string; t: TFunction }) {
  const config = match(type)
    .with("top_up", () => ({
      label: t("user.wallet.tx-type.top_up", "Top Up"),
      className: walletStatusClassNames.success,
    }))
    .with("withdraw", () => ({
      label: t("user.wallet.tx-type.withdraw", "Withdraw"),
      className: walletStatusClassNames.warning,
    }))
    .with("admin_debit", () => ({
      label: t("user.wallet.tx-type.admin_debit", "Admin Debit"),
      className: walletStatusClassNames.danger,
    }))
    .otherwise(() => ({
      label: t(`user.wallet.tx-type.${type}`, type),
      className: "",
    }));

  return (
    <DataTableBadge variant="outline" className={config.className}>
      {config.label}
    </DataTableBadge>
  );
}

export function WalletNetworkBadge({
  getChainDisplayByNetworkId,
  network,
  paymentMethod,
  t,
}: {
  getChainDisplayByNetworkId: GetChainDisplayByNetworkId;
  network?: string | null;
  paymentMethod?: string | null;
  t: TFunction;
}) {
  if (network) {
    return (
      <DataTableBadge variant="outline">
        {getChainDisplayByNetworkId(network)?.name ?? network}
      </DataTableBadge>
    );
  }

  if (paymentMethod) {
    return (
      <DataTableBadge variant="outline">
        {t(`fiat.method.${paymentMethod}`, {
          defaultValue: paymentMethod,
        })}
      </DataTableBadge>
    );
  }

  return <DataTableText>—</DataTableText>;
}

export function WalletTransactionDetail({
  description,
  explorerUrl,
  txHash,
}: {
  description: string | null;
  explorerUrl?: string;
  txHash: string | null;
}) {
  if (txHash) {
    const href = explorerUrl ? explorerTxUrl(explorerUrl, txHash) : undefined;
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-1 overflow-hidden font-mono transition-colors hover:text-foreground"
      >
        <span className="truncate">{txHash.slice(0, 12)}...</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    ) : (
      <DataTableText className="block" mono truncate>
        {txHash.slice(0, 12)}...
      </DataTableText>
    );
  }

  if (description) {
    return (
      <DataTableText className="block" truncate>
        {description}
      </DataTableText>
    );
  }

  return <DataTableText>—</DataTableText>;
}
