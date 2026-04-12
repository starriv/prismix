import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";

import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Calendar } from "@/web/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { cn } from "@/web/shared/utils";

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
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

export { DateRangePicker };
export type { DateRangePickerProps };
