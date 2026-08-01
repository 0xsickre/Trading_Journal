"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtNum, fmtR, pnlClass } from "@/lib/journal/format";
import { addMonthsToMonthKey, monthGridDays } from "@/lib/journal/time";
import {
  classifyOutcome,
  hasBreakevenBand,
  type BreakevenRange,
} from "@/lib/journal/breakeven";
import type { PeriodRow } from "@/lib/journal/period-stats";

const METRICS = [
  { key: "net", label: "Net P&L" },
  { key: "r", label: "R" },
  { key: "trades", label: "Broj trejdova" },
  { key: "winrate", label: "Win rate" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

/**
 * The figure a cell shows.
 *
 * Colour always follows **money**, never the selected metric. A day that made
 * three trades is not "green because three"; keeping the hue tied to P&L means
 * switching the metric changes what you read, not what the month feels like.
 */
function cellValue(
  row: PeriodRow,
  metric: MetricKey,
  currency: string,
): string {
  switch (metric) {
    case "net":
      return fmtMoney(row.net, currency, { sign: true });
    case "r":
      // No trade with a stop means R is not zero, it is unmeasured.
      return row.rTrades === 0 ? "—" : fmtR(row.r);
    case "trades":
      return String(row.trades);
    case "winrate": {
      // Breakeven days drop out of the denominator, matching how win rate is
      // computed everywhere else in the app.
      const decided = row.wins + row.losses;
      return decided === 0 ? "—" : `${fmtNum((row.wins / decided) * 100, 0)}%`;
    }
  }
}

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
  todayKey,
  byDay,
  byWeek,
  byMonth,
  loggedDays,
  breakevenRange,
  currency,
}: {
  monthKey: string;
  /** The month "today" falls in, so navigation cannot run into the future. */
  currentMonth: string;
  /** Today in the account's timezone, for the ring on today's cell. */
  todayKey: string;
  byDay: Map<string, PeriodRow>;
  byWeek: Map<string, PeriodRow>;
  byMonth: PeriodRow | null;
  /** Days that carry a daily report. */
  loggedDays: Set<string>;
  breakevenRange: BreakevenRange;
  currency: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("net");
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

          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <span className={cn("font-semibold tabular-nums", pnlClass(monthNet))}>
              {fmtMoney(monthNet, currency, { sign: true })}
            </span>
            <span className="text-muted-foreground">
              {byMonth?.trades ?? 0}{" "}
              {byMonth?.trades === 1 ? "trejd" : "trejdova"} · {tradingDays}{" "}
              {tradingDays === 1 ? "dan" : "dana"}
            </span>
            <Select
              value={metric}
              onValueChange={(v) => setMetric(v as MetricKey)}
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  todayKey={todayKey}
                  byDay={byDay}
                  // The row's first cell IS the ISO Monday, which is exactly the
                  // key `bucketByPeriod("week")` produces.
                  weekRow={byWeek.get(week[0]) ?? null}
                  loggedDays={loggedDays}
                  breakevenRange={breakevenRange}
                  metric={metric}
                  currency={currency}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Grey is only worth explaining once it can actually appear. Without a
            configured band it lands on exactly-zero days, which practically
            never happen on a float that already carries fees. */}
        {hasBreakevenBand(breakevenRange) && (
          <p className="mt-3 text-xs text-muted-foreground">
            Sivo = dan unutar breakeven opsega naloga (
            {fmtMoney(breakevenRange.from, currency)} do{" "}
            {fmtMoney(breakevenRange.to, currency)}), pa se ne broji ni kao
            dobitak ni kao gubitak.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WeekRow({
  week,
  monthKey,
  todayKey,
  byDay,
  weekRow,
  loggedDays,
  breakevenRange,
  metric,
  currency,
}: {
  week: string[];
  monthKey: string;
  todayKey: string;
  byDay: Map<string, PeriodRow>;
  weekRow: PeriodRow | null;
  loggedDays: Set<string>;
  breakevenRange: BreakevenRange;
  metric: MetricKey;
  currency: string;
}) {
  return (
    <>
      {week.map((day) => {
        const row = byDay.get(day) ?? null;
        const inMonth = day.startsWith(monthKey);
        const logged = loggedDays.has(day);
        const outcome = row ? classifyOutcome(row.net, breakevenRange) : null;
        return (
          <Link
            key={day}
            href={`/daily?date=${day}`}
            className={cn(
              "block min-h-[4.5rem] rounded-md border p-1.5 transition-colors hover:border-primary",
              !inMonth && "opacity-40",
              // Colour follows the OUTCOME, not the raw sign: with a band
              // configured, a day inside it is flat and must not read as a win
              // just because it ended a few cents up.
              outcome === "win" && "border-[var(--profit)]/40 bg-[var(--profit)]/5",
              outcome === "loss" && "border-[var(--loss)]/40 bg-[var(--loss)]/5",
              outcome === "breakeven" && "bg-muted",
              day === todayKey && "ring-1 ring-primary",
            )}
          >
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {Number(day.slice(8, 10))}
              </span>
              {logged && (
                <NotebookPen
                  className="size-3 text-muted-foreground"
                  aria-label="Dan ima dnevni izveštaj"
                />
              )}
            </div>
            {row && (
              <>
                <div
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    // Money drives the hue in every metric — see cellValue.
                    outcome === "breakeven"
                      ? "text-muted-foreground"
                      : pnlClass(row.net),
                  )}
                >
                  {cellValue(row, metric, currency)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {metric === "trades"
                    ? fmtMoney(row.net, currency, { sign: true })
                    : `${row.trades} ${row.trades === 1 ? "trejd" : "trejdova"}`}
                </div>
              </>
            )}
          </Link>
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
              {cellValue(weekRow, metric, currency)}
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
