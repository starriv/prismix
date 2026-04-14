import type { ComponentProps } from "react";

import type { TFunction } from "i18next";

import { removeTailingZero } from "@/shared/number";
import type { StatusBadgeColorMap } from "@/web/components/dashboard/status-badge";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { DataTableText } from "@/web/components/data-table";
import { formatTokens } from "@/web/pages/ai-usage/helpers";

export function formatUserCount(value: number): string {
  return value.toLocaleString();
}

export function formatUserTokens(value: number): string {
  return formatTokens(value);
}

export function formatUserCurrency(
  value: null | number | string | undefined,
  digits = 8,
  emptyText = "—",
): string {
  const hasValue = value !== null && value !== undefined && value !== "";
  return hasValue ? `$${removeTailingZero(value, digits)}` : emptyText;
}

export function UserCountText({
  className,
  value,
  ...props
}: Omit<ComponentProps<typeof DataTableText>, "children"> & { value: number }) {
  return (
    <DataTableText className={className} mono numeric {...props}>
      {formatUserCount(value)}
    </DataTableText>
  );
}

export function UserTokenText({
  className,
  value,
  ...props
}: Omit<ComponentProps<typeof DataTableText>, "children"> & { value: number }) {
  return (
    <DataTableText className={className} mono numeric {...props}>
      {formatUserTokens(value)}
    </DataTableText>
  );
}

export function UserCurrencyText({
  className,
  digits = 4,
  emptyText = "—",
  value,
  ...props
}: Omit<ComponentProps<typeof DataTableText>, "children"> & {
  digits?: number;
  emptyText?: string;
  value: null | number | string | undefined;
}) {
  const hasValue = value !== null && value !== undefined && value !== "";

  return (
    <DataTableText className={className} mono numeric {...props}>
      {hasValue ? formatUserCurrency(value, digits, emptyText) : emptyText}
    </DataTableText>
  );
}

export function buildKeyStatusColorMap(t: TFunction): StatusBadgeColorMap {
  return {
    active: {
      label: t("user.keys.status.active"),
      className: "border-green-500/30 bg-green-500/10 text-green-600",
    },
    revoked: {
      label: t("user.keys.status.revoked"),
      className: "border-red-500/30 bg-red-500/10 text-red-600",
    },
    expired: {
      label: t("user.keys.status.expired"),
      className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
    },
  };
}

export function UserKeyStatusBadge({
  colorMap,
  status,
}: {
  colorMap: StatusBadgeColorMap;
  status: string;
}) {
  return <StatusBadge status={status} colorMap={colorMap} />;
}
