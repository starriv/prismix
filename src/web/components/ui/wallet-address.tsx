import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Copy, ExternalLink, Wallet } from "lucide-react";
import { toast } from "sonner";

import { explorerAddressUrl } from "@/web/shared/chains";
import { cn } from "@/web/shared/utils";

import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

interface WalletAddressProps {
  /** Full wallet address (0x...) */
  address: string;
  /** Show the full address instead of truncated (default: false) */
  full?: boolean;
  /** Block explorer base URL (default: basescan sepolia) */
  explorerUrl?: string;
  /** Extra className on the container */
  className?: string;
}

/**
 * Reusable wallet address display with green-highlighted prefix/suffix,
 * copy button, and block explorer link.
 */
export function WalletAddress({
  address,
  full = false,
  explorerUrl = "https://basescan.org",
  className,
}: WalletAddressProps) {
  const { t } = useTranslation();

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    toast.success(t("common.copied"));
  }, [address, t]);

  const prefix = address.slice(0, 6);
  const middle = address.slice(6, -6);
  const suffix = address.slice(-6);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="font-mono text-xs text-ellipsis overflow-clip cursor-default underline decoration-foreground pb-0.5">
              <span className="text-green-300">{prefix}</span>
              {full ? (
                <>
                  <span className="text-muted-foreground">{middle}</span>
                  <span className="text-green-300">{suffix}</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">......</span>
                  <span className="text-green-300">{suffix}</span>
                </>
              )}
            </p>
          </TooltipTrigger>
          <TooltipContent>
            <span className="font-mono">{address}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        variant="ghost"
        size="icon"
        className="h-3.5 w-3.5 shrink-0"
        onClick={handleCopy}
        aria-label={t("common.a11y.copy")}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-3.5 w-3.5 shrink-0"
        asChild
        aria-label={t("common.a11y.external-link")}
      >
        <a
          href={explorerAddressUrl(explorerUrl, address)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
    </div>
  );
}
