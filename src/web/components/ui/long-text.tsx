import type { ComponentProps } from "react";

import { badgeVariants } from "@/web/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { cn } from "@/web/shared/utils";

type LongTextKind = "text" | "secret";
type LongTextAppearance = "badge" | "plain";

interface LongTextProps extends Omit<ComponentProps<"span">, "children"> {
  value?: string | number | null;
  kind?: LongTextKind;
  appearance?: LongTextAppearance;
  head?: number;
  tail?: number;
  emptyText?: string;
  tooltipValue?: string;
  showTooltip?: boolean;
}

function normalizePartLength(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function formatLongText(value: string, head = 8, tail = 4): string {
  const startLength = normalizePartLength(head);
  const endLength = normalizePartLength(tail);
  const separator = "...";

  if (value.length <= startLength + endLength + separator.length) return value;

  const start = value.slice(0, startLength);
  const end = endLength > 0 ? value.slice(-endLength) : "";
  return `${start}${separator}${end}`;
}

export function formatSecretText(value: string, head = 8, tail = 3): string {
  const normalizedValue = value.replace(/(?:\.{3}|…)+$/u, "");
  const wasAlreadyMasked = normalizedValue !== value;
  const startLength = normalizePartLength(head);
  const endLength = normalizePartLength(tail);
  const separator = "...";

  if (!normalizedValue) return value;

  const totalLength = normalizedValue.length;

  // For unmasked secrets too short to split into head+tail, never reveal
  // the full value — show only the first character + ellipsis.
  if (!wasAlreadyMasked && totalLength <= startLength + 1) {
    return totalLength <= 1
      ? `${normalizedValue}${separator}`
      : `${normalizedValue[0]}${separator}`;
  }

  const safeEndLength = endLength > 0 ? Math.min(endLength, totalLength - 1) : 0;
  const maxStart = Math.max(1, totalLength - safeEndLength);
  const safeStartLength = Math.min(startLength, maxStart);

  const start = normalizedValue.slice(0, safeStartLength);
  const end = safeEndLength > 0 ? normalizedValue.slice(-safeEndLength) : "";
  return `${start}${separator}${end}`;
}

export function LongText({
  value,
  kind = "text",
  appearance = "badge",
  head = 8,
  tail,
  emptyText = "—",
  tooltipValue,
  showTooltip = true,
  className,
  title,
  ...props
}: LongTextProps) {
  const rawValue = value == null || value === "" ? "" : String(value);
  if (!rawValue) {
    return (
      <span className={cn("font-mono text-xs text-muted-foreground", className)} {...props}>
        {emptyText}
      </span>
    );
  }

  const displayValue =
    kind === "secret"
      ? formatSecretText(rawValue, head, tail ?? 3)
      : formatLongText(rawValue, head, tail ?? 4);
  const contentValue = kind === "secret" ? displayValue : (tooltipValue ?? rawValue);
  const trigger = (
    <span
      tabIndex={showTooltip ? 0 : undefined}
      title={title}
      className={cn(
        appearance === "badge"
          ? cn(
              badgeVariants({ variant: "outline" }),
              "max-w-full cursor-default justify-start overflow-hidden font-mono tabular-nums [text-overflow:clip] hover:bg-muted/50",
            )
          : "inline-block max-w-full overflow-hidden whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums [text-overflow:clip]",
        className,
      )}
      {...props}
    >
      {displayValue}
    </span>
  );

  if (!showTooltip) return trigger;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent className="max-w-80 break-all">
        <span className="font-mono">{contentValue}</span>
      </TooltipContent>
    </Tooltip>
  );
}
