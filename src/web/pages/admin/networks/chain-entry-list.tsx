import { useTranslation } from "react-i18next";

import { Check } from "lucide-react";

import type { CircleNetworkEntry } from "@/web/api/schemas";
import { cn } from "@/web/shared/utils";

import { ChainIcon } from "./chain-icon";

export function ChainEntryList({
  entries,
  selected,
  onToggle,
}: {
  entries: CircleNetworkEntry[];
  selected: Set<number>;
  onToggle: (chainId: number) => void;
}) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        {t("admin.networks.all-added")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const isSelected = selected.has(entry.chainId);
        return (
          <button
            key={entry.chainId}
            type="button"
            onClick={() => onToggle(entry.chainId)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
              isSelected ? "border-primary bg-primary/5 ring-2 ring-primary" : "hover:bg-muted/50",
            )}
          >
            <ChainIcon src={entry.iconUrl} name={entry.name} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{entry.name}</span>
              <p className="text-xs text-muted-foreground font-mono">Chain {entry.chainId}</p>
            </div>
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {isSelected && <Check className="h-3 w-3" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
