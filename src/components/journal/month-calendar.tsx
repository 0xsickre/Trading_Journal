"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney, pnlClass } from "@/lib/journal/format";
import { addMonthsToMonthKey, monthGridDays } from "@/lib/journal/time";
import type { PeriodRow } from "@/lib/journal/period-stats";

const WEEKDAYS = ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"];

const MONTHS = [
  "januar",
  "februar",
  "mart",
  "april",
  "maj",
  "jun",
  "jul",
  "avgust",
  "septembar",
  "oktobar",
  "novembar",
  "decembar",
];

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS[m - 1] ?? monthKey} ${y}.`;
}

/**
 * Monthly P&L calendar.
 *
 * Deliberately not built on `HeatmapGrid`: that grid is weeks-as-columns with
 * 3px cells and no room for a number, which is the right shape for a year at a
 * glance and the wrong one for a month you read figures off. A `mode` prop would
 * have branched in every leaf.
 *
 * Every day key here is a day in the ACCOUNT's timezone, produced by
 * `monthGridDays` from pure string arithmetic. No `Date` is read in browser-local
 * time anywhere in this file.
 */
export function MonthCalendar({
  monthKey,
  currentMonth,
  byDay,
  byWeek,
  byMonth,
  currency,
}: {
  monthKey: string;
  /** The month "today" falls in, so navigation cannot run into the future. */
  currentMonth: string;
  byDay: Map<string, PeriodRow>;
  byWeek: Map<string, PeriodRow>;
  byMonth: PeriodRow | null;
  currency: string;
}) {
  const days = monthGridDays(monthKey);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const atCurrent = monthKey >= currentMonth;
  const prev = addMonthsToMonthKey(monthKey, -1);
  const next = addMonthsToMonthKey(monthKey, 1);

  const monthNet = byMonth?.net ?? 0;
  const tradingDays = [...byDay.keys()].filter((d) => d.startsWith(monthKey)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={`/calendar?month=${prev}`} aria-label="Prethodni mesec">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <CardTitle className="min-w-[9rem] text-center text-base capitalize">
            {monthLabel(monthKey)}
          </CardTitle>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            asChild
            disabled={atCurrent}
          >
            <Link
              href={`/calendar?month=${atCurrent ? monthKey : next}`}
              aria-disabled={atCurrent}
              aria-label="Sledeći mesec"
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          {monthKey !== currentMonth && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/calendar">Danas</Link>
            </Button>
          )}

          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className={cn("font-semibold tabular-nums", pnlClass(monthNet))}>
              {fmtMoney(monthNet, currency, { sign: true })}
            </span>
            <span className="text-muted-foreground">
              {byMonth?.trades ?? 0}{" "}
              {byMonth?.trades === 1 ? "trejd" : "trejdova"} · {tradingDays}{" "}
              {tradingDays === 1 ? "dan" : "dana"}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Eight columns do not fit a phone; scroll the grid rather than let the
            page scroll sideways. Same treatment as the heatmaps. */}
        <div className="min-w-0 max-w-full overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-8 gap-1 pb-1">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="px-1 text-center text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              <div className="px-1 text-center text-xs font-medium text-muted-foreground">
                Nedelja
              </div>
            </div>

            <div className="grid grid-cols-8 gap-1">
              {weeks.map((week) => (
                <WeekRow
                  key={week[0]}
                  week={week}
                  monthKey={monthKey}
                  byDay={byDay}
                  // The row's first cell IS the ISO Monday, which is exactly the
                  // key `bucketByPeriod("week")` produces.
                  weekRow={byWeek.get(week[0]) ?? null}
                  currency={currency}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WeekRow({
  week,
  monthKey,
  byDay,
  weekRow,
  currency,
}: {
  week: string[];
  monthKey: string;
  byDay: Map<string, PeriodRow>;
  weekRow: PeriodRow | null;
  currency: string;
}) {
  return (
    <>
      {week.map((day) => {
        const row = byDay.get(day) ?? null;
        const inMonth = day.startsWith(monthKey);
        return (
          <div
            key={day}
            className={cn(
              "min-h-[4.5rem] rounded-md border p-1.5",
              !inMonth && "opacity-40",
              row && row.net > 0 && "border-[var(--profit)]/40 bg-[var(--profit)]/5",
              row && row.net < 0 && "border-[var(--loss)]/40 bg-[var(--loss)]/5",
            )}
          >
            <div className="text-xs text-muted-foreground">
              {Number(day.slice(8, 10))}
            </div>
            {row && (
              <>
                <div
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    pnlClass(row.net),
                  )}
                >
                  {fmtMoney(row.net, currency, { sign: true })}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {row.trades} {row.trades === 1 ? "trejd" : "trejdova"}
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* The week column sums the WHOLE ISO week, including days that belong to
          the neighbouring month. A week is a week — cutting it at the month
          boundary would print a number that matches no period the trader had. */}
      <div className="min-h-[4.5rem] rounded-md border border-dashed p-1.5">
        <div className="text-xs text-muted-foreground">Ukupno</div>
        {weekRow ? (
          <>
            <div
              className={cn(
                "text-sm font-medium tabular-nums",
                pnlClass(weekRow.net),
              )}
            >
              {fmtMoney(weekRow.net, currency, { sign: true })}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {weekRow.trades} {weekRow.trades === 1 ? "trejd" : "trejdova"}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">—</div>
        )}
      </div>
    </>
  );
}
