/**
 * MultiSelect — lightweight multi-select with Popover + Badge tags.
 *
 * Uses existing ui primitives (Popover, Badge) — no cmdk dependency.
 * Follows shadcn/ui patterns: cn(), CVA-friendly, data-slot, Radix-based.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Check, ChevronDown, Loader2, X } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { cn } from "@/web/shared/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  maxDisplay?: number;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select...",
  maxDisplay = 3,
  className,
  disabled,
  loading,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  emptyMessage,
}: MultiSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const search = searchValue ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;

  const selected = new Set(value);
  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()),
      )
    : options;
  const selectableOptions = filtered.filter((o) => !o.disabled);
  const allSelected =
    selectableOptions.length > 0 && selectableOptions.every((o) => selected.has(o.value));

  const toggle = (optionValue: string) => {
    const next = new Set(selected);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    onValueChange([...next]);
  };

  const remove = (optionValue: string) => {
    onValueChange(value.filter((v) => v !== optionValue));
  };

  const clearAll = () => {
    onValueChange([]);
  };

  const selectAll = () => {
    onValueChange([...new Set([...value, ...selectableOptions.map((o) => o.value)])]);
  };

  const displayValues = value.slice(0, maxDisplay);
  const overflow = value.length - maxDisplay;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={open}
          aria-disabled={disabled || undefined}
          className={cn(
            "border-input bg-background flex min-h-10 h-auto w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-normal shadow-xs",
            "hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "pointer-events-none opacity-50",
            !value.length && "text-muted-foreground",
            className,
          )}
          onClick={() => {
            if (!disabled) setOpen(!open);
          }}
          onKeyDown={(e) => {
            if (!disabled && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setOpen(!open);
            }
          }}
        >
          <div className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
            {value.length === 0 ? (
              <span className="text-sm">{placeholder}</span>
            ) : options.length === 0 ? (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                {value.length} selected
              </Badge>
            ) : (
              <>
                {displayValues.map((v) => {
                  const opt = options.find((o) => o.value === v);
                  if (!opt) return null; // skip unresolvable values (options still loading)
                  return (
                    <Badge key={v} variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                      {opt.label}
                      <button
                        type="button"
                        className="ml-1 rounded-sm hover:bg-muted-foreground/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(v);
                        }}
                        aria-label={`Remove ${opt?.label ?? v}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
                {overflow > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                    +{overflow}
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 ml-2">
            {value.length > 0 && (
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
                aria-label="Clear all"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {/* Search input */}
        <div className="border-b px-3 py-2">
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder ?? t("common.btn.search")}
            aria-label={searchPlaceholder ?? t("common.btn.search")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Options list */}
        <div className="max-h-56 overflow-y-auto p-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {emptyMessage ?? t("common.no-results")}
            </p>
          ) : (
            filtered.map((option) => {
              const isSelected = selected.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => toggle(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    option.disabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30",
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t px-3 py-2 flex justify-between">
          {!allSelected ? (
            <button
              type="button"
              onClick={selectAll}
              className="text-xs text-primary hover:text-primary/80"
            >
              {t("common.btn.select-all")}
            </button>
          ) : (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.btn.clear-all")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("common.btn.done")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
