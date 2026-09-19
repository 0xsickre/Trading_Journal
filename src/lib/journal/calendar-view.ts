/**
 * The pure half of `/calendar`: its URLs, what a month adds up to, and the
 * twelve months of the year beside it.
 */

import { classifyOutcome, type BreakevenRange } from "./breakeven";
import type { PeriodRow } from "./period-stats";

export type CalendarView = "grid" | "list";

/**
 * One builder for every link on the screen.
 *
 * The month arrows, the Today button and the Grid/List toggle each wrote their
 * own query string, so a parameter one of them did not know about — the view,
 * and now the account — fell off whenever the reader moved.
 * Defaults are left out, so the plain `/calendar` stays the canonical URL.
 */
export function calendarHref({
  month,
  view = "grid",
  account = "all",
}: {
  month?: string | null;
  view?: CalendarView;
  account?: string;
}): string {
  const q = new URLSearchParams();
  if (month) q.set("month", month);
  if (view === "list") q.set("view", "list");
  if (account && account !== "all") q.set("account", account);
  const s = q.toString();
  return s ? `/calendar?${s}` : "/calendar";
}

export type MonthSummary = {
  net: number;
  trades: number;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  best: PeriodRow | null;
  worst: PeriodRow | null;
  /** Net per day that had a closed trade — null with no such day. */
  avgPerDay: number | null;
};

/**
 * What a month adds up to, from its day rows.
 *
 * Green and red follow the breakeven band, the same rule that colours the
 * cells — a +$8 day inside a ±$20 band is neither, here as on the grid.
 */
export function summarizeMonth(
  monthKey: string,
  byDay: ReadonlyMap<string, PeriodRow>,
  range: BreakevenRange,
): MonthSummary {
  const days = [...byDay.values()].filter((r) => r.key.startsWith(`${monthKey}-`));
  let net = 0;
  let trades = 0;
  let green = 0;
  let red = 0;
  let best: PeriodRow | null = null;
  let worst: PeriodRow | null = null;
  for (const d of days) {
    net += d.net;
    trades += d.trades;
    const o = classifyOutcome(d.net, range);
    if (o === "win") green++;
    else if (o === "loss") red++;
    if (best == null || d.net > best.net) best = d;
    if (worst == null || d.net < worst.net) worst = d;
  }
  return {
    net,
    trades,
    tradingDays: days.length,
    greenDays: green,
    redDays: red,
    best,
    worst,
    avgPerDay: days.length > 0 ? net / days.length : null,
  };
}

export type YearMonth = {
  month: string;
  row: PeriodRow | null;
  /** After the current month — nothing can be in it yet. */
  future: boolean;
};

/** The twelve months of `monthKey`'s year, January first. */
export function yearMonths(
  monthKey: string,
  byMonth: ReadonlyMap<string, PeriodRow>,
  currentMonth: string,
): YearMonth[] {
  const year = monthKey.slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, row: byMonth.get(month) ?? null, future: month > currentMonth };
  });
}
