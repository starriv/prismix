import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { toast } from "sonner";

import { cn } from "@/web/shared/utils";

interface CopyableTextProps {
  /** The text to copy to clipboard (defaults to children string if omitted) */
  value?: string;
  /** Display content */
  children: React.ReactNode;
  /** Extra className on the wrapper */
  className?: string;
}

/**
 * Inline text that copies to clipboard on click.
 * Shows underline on hover; fires a toast on success.
 */
export function CopyableText({ value, children, className }: CopyableTextProps) {
  const { t } = useTranslation();

  const handleClick = useCallback(async () => {
    const text = value ?? (typeof children === "string" ? children : "");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success(t("common.copied"));
  }, [value, children, t]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "cursor-pointer bg-transparent p-0 text-left",
        "hover:underline hover:underline-offset-2 hover:decoration-muted-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
