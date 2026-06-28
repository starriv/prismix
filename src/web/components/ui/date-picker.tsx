import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";

import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Calendar } from "@/web/components/ui/calendar";
import { Input } from "@/web/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { cn } from "@/web/shared/utils";

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
}

interface DateTimePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  min?: Date;
}

function parseLocalDateTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function withDatePart(base: Date, datePart: Date): Date {
  const next = new Date(base);
  next.setFullYear(datePart.getFullYear(), datePart.getMonth(), datePart.getDate());
  next.setSeconds(0, 0);
  return next;
}

function formatTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseTimePart(key: "hours" | "minutes", raw: string): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (key === "hours" && (value < 0 || value > 23)) return null;
  if (key === "minutes" && (value < 0 || value > 59)) return null;
  return value;
}

function withTimePart(base: Date, key: "hours" | "minutes", value: number): Date {
  const next = new Date(base);
  if (key === "hours") next.setHours(value);
  else next.setMinutes(value);
  next.setSeconds(0, 0);
  return next;
}

function sanitizeTimeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 2);
}

function DateRangePicker({ value, onChange, placeholder, className }: DateRangePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(value);

  function handleOpen(next: boolean) {
    if (next) {
      setDraft(value);
    }
    setOpen(next);
  }

  function handleConfirm() {
    onChange?.(draft);
    setOpen(false);
  }

  function handleClear() {
    onChange?.(undefined);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal",
            !value?.from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-3.5" />
          {value?.from ? (
            value.to ? (
              <>
                {format(value.from, "yyyy-MM-dd")} – {format(value.to, "yyyy-MM-dd")}
              </>
            ) : (
              format(value.from, "yyyy-MM-dd")
            )
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="range"
          defaultMonth={draft?.from}
          selected={draft}
          onSelect={setDraft}
          numberOfMonths={2}
        />
        <div className="flex items-center border-t px-4 py-3">
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={!value?.from}>
            {t("common.btn.clear")}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("common.btn.cancel")}
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={!draft?.from}>
              {t("common.btn.confirm")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateTimePicker({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  min,
}: DateTimePickerProps) {
  const selected = parseLocalDateTime(value);
  const base = selected ?? min ?? new Date();
  const minDay = min ? startOfLocalDay(min) : undefined;
  const timeValue = selected ?? min ?? new Date();
  const displayHours = formatTimePart(timeValue.getHours());
  const displayMinutes = formatTimePart(timeValue.getMinutes());

  return (
    <DateTimePickerContent
      key={`${value ?? ""}:${min?.getTime() ?? ""}:${displayHours}:${displayMinutes}`}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      min={min}
      selected={selected}
      base={base}
      minDay={minDay}
      displayHours={displayHours}
      displayMinutes={displayMinutes}
    />
  );
}

function DateTimePickerContent({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  min,
  selected,
  base,
  minDay,
  displayHours,
  displayMinutes,
}: DateTimePickerProps & {
  selected: Date | undefined;
  base: Date;
  minDay: Date | undefined;
  displayHours: string;
  displayMinutes: string;
}) {
  const { t } = useTranslation();
  const [timeDraft, setTimeDraft] = useState({
    hours: displayHours,
    minutes: displayMinutes,
  });

  function commit(date: Date) {
    onChange?.(formatLocalDateTime(date));
  }

  function applyDraftTime(date: Date): Date {
    let next = date;
    const hours = parseTimePart("hours", timeDraft.hours);
    const minutes = parseTimePart("minutes", timeDraft.minutes);
    if (hours !== null) next = withTimePart(next, "hours", hours);
    if (minutes !== null) next = withTimePart(next, "minutes", minutes);
    return next;
  }

  function handleSelect(date: Date | undefined) {
    if (!date) return;
    commit(applyDraftTime(withDatePart(base, date)));
  }

  function handleTimeChange(key: "hours" | "minutes", raw: string) {
    setTimeDraft((current) => ({ ...current, [key]: sanitizeTimeInput(raw) }));
  }

  function handleTimeCommit(key: "hours" | "minutes") {
    const fallback = key === "hours" ? displayHours : displayMinutes;
    const value = parseTimePart(key, timeDraft[key]);
    if (value === null) {
      setTimeDraft((current) => ({ ...current, [key]: fallback }));
      return;
    }

    setTimeDraft((current) => ({ ...current, [key]: formatTimePart(value) }));
    commit(withTimePart(base, key, value));
  }

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!selected}
          className={cn(
            "w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4" />
          {selected ? format(selected, "yyyy/MM/dd HH:mm") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? min}
          onSelect={handleSelect}
          disabled={minDay ? (date) => date < minDay : undefined}
        />
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">HH</div>
              <Input
                className="h-8 w-16 text-center font-mono"
                inputMode="numeric"
                maxLength={2}
                pattern="[0-9]*"
                type="text"
                value={timeDraft.hours}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => handleTimeChange("hours", event.target.value)}
                onBlur={() => handleTimeCommit("hours")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Hour"
              />
            </div>
            <div className="pb-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">MM</div>
              <Input
                className="h-8 w-16 text-center font-mono"
                inputMode="numeric"
                maxLength={2}
                pattern="[0-9]*"
                type="text"
                value={timeDraft.minutes}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => handleTimeChange("minutes", event.target.value)}
                onBlur={() => handleTimeCommit("minutes")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Minute"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onChange?.("")}
              disabled={!value}
            >
              {t("common.btn.clear")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DateRangePicker, DateTimePicker };
export type { DateRangePickerProps, DateTimePickerProps };
