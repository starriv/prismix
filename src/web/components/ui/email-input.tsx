import { useCallback, useMemo, useState } from "react";

import { cn } from "@/web/shared/utils";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";

// ── Constants ───────────────────────────────────────────────────

const EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "qq.com",
  "163.com",
];

// ── Component ───────────────────────────────────────────────────

interface EmailInputProps extends Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange"
> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function EmailInput({ value, onChange, className, onKeyDown, ...props }: EmailInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Build suggestion list based on current value
  const suggestions = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const atIdx = trimmed.indexOf("@");

    // No "@" yet → append all domains
    if (atIdx === -1) {
      return EMAIL_DOMAINS.map((d) => `${trimmed}@${d}`);
    }

    const local = trimmed.slice(0, atIdx);
    const domainPart = trimmed.slice(atIdx + 1);

    if (!local) return [];

    // Filter domains that start with what user typed after "@"
    const matched = EMAIL_DOMAINS.filter((d) => d.startsWith(domainPart) && d !== domainPart);
    return matched.map((d) => `${local}@${d}`);
  }, [value]);

  const showPopover = open && suggestions.length > 0;

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      // Synthesize a change event so the parent's onChange works unchanged
      const nativeEvent = new Event("change", { bubbles: true });
      Object.defineProperty(nativeEvent, "target", {
        writable: false,
        value: { value: suggestion },
      });
      onChange(nativeEvent as unknown as React.ChangeEvent<HTMLInputElement>);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (showPopover) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
          return;
        }
        if ((e.key === "Enter" || e.key === "Tab") && activeIndex >= 0) {
          e.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
          return;
        }
        if (e.key === "Escape") {
          setOpen(false);
          setActiveIndex(-1);
          return;
        }
      }
      onKeyDown?.(e);
    },
    [showPopover, activeIndex, suggestions, selectSuggestion, onKeyDown],
  );

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <input
          data-slot="input"
          type="email"
          value={value}
          onChange={(e) => {
            onChange(e);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
            className,
          )}
          {...props}
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul role="listbox" className="max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === activeIndex}
              data-active={i === activeIndex || undefined}
              className="cursor-pointer rounded-sm px-2 py-1.5 text-sm select-none data-[active]:bg-accent data-[active]:text-accent-foreground"
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on input
                selectSuggestion(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export { EmailInput };
