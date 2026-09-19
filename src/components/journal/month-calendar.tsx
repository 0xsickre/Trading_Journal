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
import { winRateOf } from "@/lib/journal/analytics";
import { fmtMoney, fmtNum, fmtR, pnlClass } from "@/lib/journal/format";
import {
  WEEKDAY_LABELS,
  addMonthsToMonthKey,
  monthGridDays,
  monthLabel,
} from "@/lib/journal/time";
import {
  classifyOutcome,
  hasBreakevenBand,
  type BreakevenRange,
} from "@/lib/journal/breakeven";
import type { PeriodRow } from "@/lib/journal/period-stats";
import {
  calendarHref,
  yearMonths,
  type MonthSummary,
} from "@/lib/journal/calendar-view";

const METRICS = [
  { key: "net", label: "Net P&L" },
  { key: "r", label: "R" },
  { key: "trades", label: "Trade count" },
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
      // computed everywhere else in the app — `winRateOf` IS that "everywhere
      // else". It returns null without making a single decision; the "—" is
      // THIS screen's choice.
      const pct = winRateOf(row.wins, row.losses);
      return pct == null ? "—" : `${fmtNum(pct, 0)}%`;
    }
  }
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
  accountId = "all",
}: {
  monthKey: string;
  /** The month "today" falls in, so navigation cannot run into the future. */
  currentMonth: string;
  /** Today in the account's timezone, for the ring on today's cell. */
  todayKey: string;
  byDay: Map<string, PeriodRow>;
  byWeek: Map<string, PeriodRow>;
  /** Every month's row — the year strip under the grid reads its twelve. */
  byMonth: Map<string, PeriodRow>;
  /** Days that carry a daily report. */
  loggedDays: Set<string>;
  breakevenRange: BreakevenRange;
  currency: string;
  /** Carried on every link, so moving month keeps the account. */
  accountId?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("net");
  const days = monthGridDays(monthKey);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const prev = addMonthsToMonthKey(monthKey, -1);
  const next = addMonthsToMonthKey(monthKey, 1);

  const href = (month: string) => calendarHref({ month, account: accountId });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav
            monthKey={monthKey}
            currentMonth={currentMonth}
            prevHref={href(prev)}
            nextHref={href(next)}
            todayHref={href(currentMonth)}
          />

          {/* The month's totals live in the summary bar above the card now; they
              were printed here too, the same figures twice on one screen. */}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
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
              {WEEKDAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="px-1 text-center text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              <div className="px-1 text-center text-xs font-medium text-muted-foreground">
                Week
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
        <p className="mt-3 text-xs text-muted-foreground">
          P&amp;L sits on the day a trade <b>closed</b> — that is when the money
          arrived.
          {/* Grey is only worth explaining once it can actually appear. */}
          {hasBreakevenBand(breakevenRange) && (
            <>
              {" "}Grey = inside the breakeven range (
              {fmtMoney(breakevenRange.from, currency)} to{" "}
              {fmtMoney(breakevenRange.to, currency)}), neither a win nor a loss.
            </>
          )}
        </p>

        <YearStrip
          months={yearMonths(monthKey, byMonth, currentMonth)}
          selected={monthKey}
          currency={currency}
          breakevenRange={breakevenRange}
          href={href}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Previous / next / today. "Next" on the current month is a real disabled
 * button: it used to be a link with `disabled` on it — which an anchor ignores
 * — so clicking it reloaded the same month.
 */
export function MonthNav({
  monthKey,
  currentMonth,
  prevHref,
  nextHref,
  todayHref,
}: {
  monthKey: string;
  currentMonth: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const atCurrent = monthKey >= currentMonth;
  return (
    <>
      <Button variant="outline" size="icon" className="size-8" asChild>
        <Link href={prevHref} aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </Link>
      </Button>
      <CardTitle className="min-w-[9rem] text-center text-base capitalize">
        {monthLabel(monthKey)}
      </CardTitle>
      {atCurrent ? (
        <Button variant="outline" size="icon" className="size-8" disabled aria-label="Next month">
          <ChevronRight className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-8" asChild>
          <Link href={nextHref} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      )}
      {monthKey !== currentMonth && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={todayHref}>Today</Link>
        </Button>
      )}
    </>
  );
}

/**
 * The month's totals, above either view — what a trader asks of a month
 * before looking at any single day.
 */
export function MonthSummaryBar({
  summary,
  currency,
}: {
  summary: MonthSummary;
  currency: string;
}) {
  const money = (v: number | null | undefined) =>
    v == null ? "—" : fmtMoney(v, currency, { sign: true });
  const cells: { label: string; value: string; cls?: string; sub?: string }[] = [
    { label: "Net P/L", value: money(summary.net), cls: pnlClass(summary.net) },
    {
      label: "Trades",
      value: String(summary.trades),
      sub: `${summary.tradingDays} ${summary.tradingDays === 1 ? "day" : "days"} traded`,
    },
    {
      label: "Green / red days",
      value: `${summary.greenDays} / ${summary.redDays}`,
    },
    {
      label: "Best day",
      value: money(summary.best?.net),
      cls: pnlClass(summary.best?.net),
      sub: summary.best ? dayLabel(summary.best.key) : undefined,
    },
    {
      label: "Worst day",
      value: money(summary.worst?.net),
      cls: pnlClass(summary.worst?.net),
      sub: summary.worst ? dayLabel(summary.worst.key) : undefined,
    },
    {
      label: "Avg per day",
      value: money(summary.avgPerDay),
      cls: pnlClass(summary.avgPerDay),
      sub: "over days traded",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className={cn("text-base font-semibold tabular-nums", c.cls)}>{c.value}</div>
          {c.sub && <div className="text-[11px] text-muted-foreground">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function dayLabel(dayKey: string): string {
  return `${Number(dayKey.slice(8, 10))} ${monthLabel(dayKey.slice(0, 7)).split(" ")[0].slice(0, 3)}`;
}

/** The year the month sits in, twelve cells wide — each one a way into its month. */
function YearStrip({
  months,
  selected,
  currency,
  breakevenRange,
  href,
}: {
  months: ReturnType<typeof yearMonths>;
  selected: string;
  currency: string;
  breakevenRange: BreakevenRange;
  href: (month: string) => string;
}) {
  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
        {selected.slice(0, 4)}
      </div>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-12">
        {months.map(({ month, row, future }) => {
          const outcome = row ? classifyOutcome(row.net, breakevenRange) : null;
          const body = (
            <>
              <div className="text-[11px] text-muted-foreground">
                {monthLabel(month).split(" ")[0].slice(0, 3)}
              </div>
              <div
                className={cn(
                  "text-xs font-medium tabular-nums",
                  row ? (outcome === "breakeven" ? "text-muted-foreground" : pnlClass(row.net)) : "text-muted-foreground",
                )}
              >
                {row ? fmtMoney(row.net, currency, { sign: true }) : "—"}
              </div>
            </>
          );
          const cls = cn(
            "block rounded-md border px-1.5 py-1",
            month === selected && "ring-1 ring-primary",
            outcome === "win" && "border-[var(--profit)]/40 bg-[var(--profit)]/5",
            outcome === "loss" && "border-[var(--loss)]/40 bg-[var(--loss)]/5",
          );
          return future ? (
            <div key={month} className={cn(cls, "opacity-40")}>
              {body}
            </div>
          ) : (
            <Link
              key={month}
              href={href(month)}
              className={cn(cls, "hover:border-primary")}
              aria-label={`${monthLabel(month)}${row ? `, ${row.trades} trades` : ""}`}
            >
              {body}
            </Link>
          );
        })}
      </div>
    </div>
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
        // A day that has not happened is not a link: `/daily` would quietly
        // clamp it to today and open a different day than the one clicked.
        const future = day > todayKey;
        // Same markup either way; only a real day is a link.
        const Cell = (future ? "div" : Link) as typeof Link;
        return (
          <Cell
            key={day}
            href={`/daily?date=${day}`}
            className={cn(
              "block min-h-[4.5rem] rounded-md border p-1.5 transition-colors",
              !future && "hover:border-primary",
              (!inMonth || future) && "opacity-40",
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
                  aria-label="Day has a daily report"
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
                    : `${row.trades} ${row.trades === 1 ? "trade" : "trades"}`}
                </div>
              </>
            )}
          </Cell>
        );
      })}

      {/* The week column sums the WHOLE ISO week, including days that belong to
          the neighbouring month. A week is a week — cutting it at the month
          boundary would print a number that matches no period the trader had. */}
      <div className="min-h-[4.5rem] rounded-md border border-dashed p-1.5">
        <div className="text-xs text-muted-foreground">Total</div>
        {weekRow ? (
          <>
            <div
              className={cn(
                "text-sm font-medium tabular-nums",
                // Same rule as the day cells: a week inside the breakeven band
                // is flat, not green because it ended a few dollars up.
                classifyOutcome(weekRow.net, breakevenRange) === "breakeven"
                  ? "text-muted-foreground"
                  : pnlClass(weekRow.net),
              )}
            >
              {cellValue(weekRow, metric, currency)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {weekRow.trades} {weekRow.trades === 1 ? "trade" : "trades"}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">—</div>
        )}
      </div>
    </>
  );
}
