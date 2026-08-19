import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney, pnlClass } from "@/lib/journal/format";
import {
  WEEKDAY_LABELS,
  addMonthsToMonthKey,
  isoWeekdayOfDayKey,
} from "@/lib/journal/time";
import type { MonthDayEntry } from "@/lib/journal/month-day-list";
import type { DailyReportListRow } from "@/lib/journal/daily-report-queries";

/**
 * The month as a list, showing what the grid cannot.
 *
 * `/calendar`'s grid answers money: P&L, trade count, a colour. Everything the
 * daily check-in actually asks — how you felt, which impulse you caught, whether
 * you wrote anything, whether the day is sealed — is invisible there, and to
 * read it across a month you have to open thirty days one at a time.
 *
 * So this is deliberately NOT a second grid. The month's shape is the grid's
 * job and it does it better; this is a reading list, newest first, with the
 * empty days left out.
 */
export function MonthDayList({
  monthKey,
  currentMonth,
  monthLabel,
  entries,
  currency,
}: {
  monthKey: string;
  /** The month "today" falls in — navigation cannot run past it. */
  currentMonth: string;
  monthLabel: string;
  entries: readonly MonthDayEntry[];
  currency: string;
}) {
  const atCurrent = monthKey >= currentMonth;
  const prev = addMonthsToMonthKey(monthKey, -1);
  const next = addMonthsToMonthKey(monthKey, 1);

  // Every link keeps `view=list`. Without it the month arrows would quietly
  // drop the reader back into the grid, which reads as the app losing its place.
  const href = (m: string) => `/calendar?month=${m}&view=list`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={href(prev)} aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <CardTitle className="min-w-[9rem] text-center text-base capitalize">
            {monthLabel}
          </CardTitle>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            asChild
            disabled={atCurrent}
          >
            <Link
              href={href(atCurrent ? monthKey : next)}
              aria-disabled={atCurrent}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          {monthKey !== currentMonth && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={href(currentMonth)}>Today</Link>
            </Button>
          )}

          <span className="ml-auto text-sm text-muted-foreground">
            {entries.length} {entries.length === 1 ? "day" : "days"}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing traded and nothing written this month.
          </p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <DayRow key={e.day} entry={e} currency={currency} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DayRow({
  entry,
  currency,
}: {
  entry: MonthDayEntry;
  currency: string;
}) {
  const { day, row, journal, compliancePct } = entry;

  return (
    <li>
      <Link
        href={`/daily?date=${day}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 hover:bg-muted/40"
      >
        <span className="w-28 shrink-0 text-sm font-medium tabular-nums">
          {weekdayOf(day)} {day.slice(8)}
        </span>

        {/* Money. A day with no trade shows a dash, not a zero — the journal is
            why the row is here, and claiming a flat result would be a claim. */}
        <span
          className={cn(
            "w-24 shrink-0 text-sm font-semibold tabular-nums",
            row ? pnlClass(row.net) : "text-muted-foreground",
          )}
        >
          {row ? fmtMoney(row.net, currency, { sign: true }) : "—"}
        </span>

        <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
          {row ? `${row.trades}t` : ""}
        </span>

        {/* Mental temperature, on the 1–10 scale the check-in asks for. Under 5
            is the threshold that page already warns at, so it is the one worth
            colouring here too. */}
        <span className="w-20 shrink-0 text-xs tabular-nums">
          {journal?.mental_temp == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span
              className={cn(
                journal.mental_temp < 5 && "text-[var(--loss)]",
                journal.mental_temp >= 8 && "text-[var(--profit)]",
              )}
            >
              temp {journal.mental_temp}
            </span>
          )}
        </span>

        <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
          {compliancePct == null ? "—" : `${Math.round(compliancePct)}%`}
        </span>

        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {impulsesOf(journal).map((label) => (
            <Badge key={label} variant="outline" className="text-[10px]">
              {label}
            </Badge>
          ))}
          {journal?.no_trade_day && (
            <Badge variant="secondary" className="text-[10px]">
              No trade
            </Badge>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          {journal?.hasNote && <NotebookPen className="size-3.5" />}
          {journal?.locked && <Lock className="size-3.5" />}
        </span>
      </Link>
    </li>
  );
}

/**
 * The impulses actually ticked, in Douglas' order.
 *
 * Only the ticked ones. Four greyed-out labels on every row would make a clean
 * day look as busy as a bad one, and the list is scanned, not read.
 */
function impulsesOf(journal: DailyReportListRow | null): string[] {
  if (!journal) return [];
  const out: string[] = [];
  if (journal.impulse_fomo) out.push("FOMO");
  if (journal.impulse_fear) out.push("Fear of losing");
  if (journal.impulse_fear_wrong) out.push("Fear of being wrong");
  if (journal.impulse_greed) out.push("Left money");
  return out;
}

/**
 * Weekday label for a day key.
 *
 * Through `isoWeekdayOfDayKey` rather than a `Date`: that helper exists because
 * `new Date("2026-04-07").getDay()` parses as UTC and reads as local, naming the
 * day before west of Greenwich. It answers 1–7 with 0 for an unparseable key,
 * which is why the lookup is guarded rather than indexed blindly.
 */
function weekdayOf(day: string): string {
  const iso = isoWeekdayOfDayKey(day);
  return iso === 0 ? "" : WEEKDAY_LABELS[iso - 1];
}
