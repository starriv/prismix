"use client";

import type { ComponentProps } from "react";

import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/web/components/ui/badge";
import { getDateLocale } from "@/web/shared/date-locale";
import { cn } from "@/web/shared/utils";

export const dataTableMeta = {
  right: { align: "right" as const },
  rightHiddenOnMobile: { align: "right" as const, hiddenOnMobile: true as const },
  hiddenOnMobile: { hiddenOnMobile: true as const },
  stickyRight: { align: "right" as const, sticky: "right" as const },
  wrap: { cellClassName: "whitespace-normal" as const },
};

interface DataTableTextProps extends ComponentProps<"span"> {
  mono?: boolean;
  muted?: boolean;
  nowrap?: boolean;
  numeric?: boolean;
  truncate?: boolean;
}

export function DataTableText({
  className,
  mono = false,
  muted = false,
  nowrap = false,
  numeric = false,
  truncate = false,
  ...props
}: DataTableTextProps) {
  return (
    <span
      className={cn(
        mono && "font-mono text-xs",
        muted && "text-muted-foreground",
        nowrap && "whitespace-nowrap",
        numeric && "tabular-nums",
        truncate && "block truncate",
        className,
      )}
      {...props}
    />
  );
}

interface DataTableRelativeTimeProps extends Omit<DataTableTextProps, "children"> {
  language: string;
  value: Date | number | string;
}

export function DataTableRelativeTime({
  language,
  value,
  className,
  ...props
}: DataTableRelativeTimeProps) {
  return (
    <DataTableText className={className} muted nowrap {...props}>
      {formatDistanceToNow(new Date(value), {
        addSuffix: true,
        locale: getDateLocale(language),
      })}
    </DataTableText>
  );
}

export function DataTableBadge({
  className,
  variant = "outline",
  ...props
}: ComponentProps<typeof Badge>) {
  return <Badge className={cn("text-xs", className)} variant={variant} {...props} />;
}
