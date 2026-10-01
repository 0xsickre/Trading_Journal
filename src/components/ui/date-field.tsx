"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MONTH_NAMES,
  WEEKDAY_LABELS,
  addMonthsToMonthKey,
  dayKeyLabel,
  isValidDayKey,
  isValidMonthKey,
  monthGridDays,
  monthLabel,
} from "@/lib/journal/time";
import { cn } from "@/lib/utils";

/*
 * Date fields that read the same in every browser: dd/MM/yyyy (`DATE`) and English
 * month names.
 *
 * `<input type="date">`, `"month"`, `"week"` and `"datetime-local"` draw their text
 * in the BROWSER's language, not the page's — on a Serbian system the journal showed
 * "дд.мм.гггг." and Cyrillic months (trader, 01.10.2026). The values stay what the
 * native inputs gave ("yyyy-MM-dd", "yyyy-MM"), so no caller's state changed shape.
 */

const todayKey = () => format(new Date(), "yyyy-MM-dd");

type FieldProps = {
  id?: string;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
  /** Offer "Clear" (an optional date); a required one only offers "Today". */
  clearable?: boolean;
};

function Trigger({
  id,
  className,
  "aria-label": ariaLabel,
  disabled,
  text,
  empty,
}: FieldProps & { text: string; empty: boolean }) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "h-9 justify-start gap-2 px-3 font-normal tabular-nums",
          empty && "text-muted-foreground",
          className,
        )}
      >
        <CalendarDays className="opacity-60" />
        {text}
      </Button>
    </PopoverTrigger>
  );
}

function Header({ label, onStep, unit }: { label: string; onStep: (delta: number) => void; unit: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Previous ${unit}`} onClick={() => onStep(-1)}>
        <ChevronLeft />
      </Button>
      <span className="text-sm font-medium">{label}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Next ${unit}`} onClick={() => onStep(1)}>
        <ChevronRight />
      </Button>
    </div>
  );
}

function Footer({ onToday, onClear }: { onToday: () => void; onClear?: () => void }) {
  return (
    <div className="mt-2 flex justify-between gap-2">
      <Button type="button" variant="ghost" size="xs" onClick={onToday}>
        Today
      </Button>
      {onClear && (
        <Button type="button" variant="ghost" size="xs" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}

/** One day, as "yyyy-MM-dd" ("" when empty). */
export function DateField({
  value,
  onChange,
  display = dayKeyLabel,
  clearable = false,
  ...field
}: FieldProps & {
  value: string;
  onChange: (day: string) => void;
  /** What the closed field says for a picked day; dd/MM/yyyy by default. */
  display?: (day: string) => string;
}) {
  const picked = isValidDayKey(value) ? value : "";
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(() => (picked || todayKey()).slice(0, 7));
  const today = todayKey();
  const pick = (day: string) => {
    onChange(day);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth((picked || todayKey()).slice(0, 7));
        setOpen(next);
      }}
    >
      <Trigger {...field} text={picked ? display(picked) : "dd/mm/yyyy"} empty={!picked} />
      <PopoverContent align="start" className="w-auto p-3">
        <Header label={monthLabel(month)} unit="month" onStep={(d) => setMonth(addMonthsToMonthKey(month, d))} />
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w} className="py-1 text-[11px] text-muted-foreground">
              {w.slice(0, 2)}
            </span>
          ))}
          {monthGridDays(month).map((day) => (
            <button
              key={day}
              type="button"
              aria-label={dayKeyLabel(day)}
              aria-pressed={day === picked}
              onClick={() => pick(day)}
              className={cn(
                "size-8 rounded-md text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                day.slice(0, 7) !== month && "text-muted-foreground/50",
                day === today && "font-semibold text-primary",
                day === picked && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {Number(day.slice(8, 10))}
            </button>
          ))}
        </div>
        <Footer onToday={() => pick(today)} onClear={clearable ? () => pick("") : undefined} />
      </PopoverContent>
    </Popover>
  );
}

/** One month, as "yyyy-MM". */
export function MonthField({
  value,
  onChange,
  clearable = false,
  ...field
}: FieldProps & { value: string; onChange: (month: string) => void }) {
  const picked = isValidMonthKey(value) ? value : "";
  const [open, setOpen] = React.useState(false);
  const [year, setYear] = React.useState(() => Number((picked || todayKey()).slice(0, 4)));
  const pick = (month: string) => {
    onChange(month);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setYear(Number((picked || todayKey()).slice(0, 4)));
        setOpen(next);
      }}
    >
      <Trigger {...field} text={picked ? monthLabel(picked) : "Month"} empty={!picked} />
      <PopoverContent align="start" className="w-64 p-3">
        <Header label={String(year)} unit="year" onStep={(d) => setYear(year + d)} />
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES.map((name, i) => {
            const key = `${year}-${String(i + 1).padStart(2, "0")}`;
            return (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={key === picked ? "default" : "ghost"}
                aria-label={monthLabel(key)}
                aria-pressed={key === picked}
                onClick={() => pick(key)}
              >
                {name.slice(0, 3)}
              </Button>
            );
          })}
        </div>
        <Footer
          onToday={() => pick(todayKey().slice(0, 7))}
          onClear={clearable ? () => pick("") : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
