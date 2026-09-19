/**
 * The pure half of the Trades screen: which period a trade falls in, what the
 * filtered set adds up to, and the view state the screen remembers.
 *
 * Kept out of `journal-grid.tsx` so each rule is testable without rendering a
 * table — and so the summary above the table reads the same functions the
 * dashboard does (`toRealized`, `computeStats`) instead of a third copy.
 */

import { computeStats, toRealized, type Stats } from "./analytics";
import { sharedBreakevenRange } from "./breakeven";
import { sharedCurrency } from "./format";
import { addDaysToDayKey, zonedDateKey, zonedWeekStartKey } from "./time";
import type { Account, TradeRow } from "./types";

// --- Period -----------------------------------------------------------------

export const PERIODS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "custom", label: "Custom…" },
] as const;

export type Period = (typeof PERIODS)[number]["value"];

export function isPeriod(v: unknown): v is Period {
  return PERIODS.some((p) => p.value === v);
}

/** Inclusive day-key bounds; an absent side is open. */
export type DayBounds = { from: string | null; to: string | null };

/**
 * The day-key window a period covers, counted from `now` in `tz`.
 *
 * Day keys, not instants: "this week" means the calendar week on the trader's
 * clock, and a rolling "7 × 24 h" window would move a Monday-morning trade in
 * and out of it depending on the hour the page was opened.
 */
export function periodBounds(
  period: Period,
  now: Date,
  tz: string,
  custom: DayBounds = { from: null, to: null },
): DayBounds {
  const today = zonedDateKey(now, tz);
  switch (period) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: zonedWeekStartKey(now, tz), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "30d":
      return { from: addDaysToDayKey(today, -29), to: today };
    case "90d":
      return { from: addDaysToDayKey(today, -89), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return { from: custom.from || null, to: custom.to || null };
  }
}

/** Whether a day key sits inside the bounds. An unknown day is outside any bounded window. */
export function inBounds(day: string, bounds: DayBounds): boolean {
  if (bounds.from == null && bounds.to == null) return true;
  if (!day) return false;
  if (bounds.from != null && day < bounds.from) return false;
  if (bounds.to != null && day > bounds.to) return false;
  return true;
}

/**
 * The day a trade belongs to on this screen: the day it was OPENED, in its
 * account's timezone — the same instant the "Opened" column prints. A plan
 * with no fill yet falls back to when it was written.
 */
export function tradeDayKey(t: TradeRow, tz: string): string {
  return zonedDateKey(t.stats?.opened_at ?? t.created_at, tz);
}

// --- Summary ----------------------------------------------------------------

export type TradesSummary = {
  /** Closed trades — the population every figure below is computed over. */
  closed: number;
  /** Positions still on (open or partially closed). */
  live: number;
  /** Plans and missed setups: in the list, but not trades yet. */
  notTaken: number;
  stats: Stats | null;
  /**
   * The currency money is summed in, or null when the trades in scope span
   * accounts in different currencies — adding USD to EUR is not a number.
   */
  currency: string | null;
};

/**
 * What the filtered set adds up to.
 *
 * Closed trades only, as on the dashboard: an open position's P&L is not
 * realized, and averaging it in would move the win rate every time the price
 * ticks. The breakeven band and the currency come from the accounts the trades
 * actually belong to — not every account the user owns — so filtering to one
 * account uses that account's own band.
 */
export function summarizeTrades(
  trades: TradeRow[],
  accounts: Account[],
): TradesSummary {
  let live = 0;
  let notTaken = 0;
  for (const t of trades) {
    if (t.status === "open" || t.status === "partial") live++;
    else if (t.status === "planned" || t.status === "missed") notTaken++;
  }

  const ids = new Set(trades.map((t) => t.account_id));
  const inScope = accounts.filter((a) => ids.has(a.id));
  const currency = sharedCurrency(inScope);
  const realized = toRealized(trades);

  return {
    closed: realized.length,
    live,
    notTaken,
    stats:
      realized.length > 0
        ? computeStats(realized, "net", sharedBreakevenRange(inScope))
        : null,
    currency,
  };
}

// --- Remembered view state --------------------------------------------------

/**
 * What the list remembers between visits in one tab: open a trade, save it,
 * and come back to the same filters, sort and page — instead of the whole
 * book from the top, which is what every save used to land on.
 *
 * sessionStorage, not the database: it is a convenience for this tab, not a
 * preference, and a fresh tab starting clean is the expected behaviour.
 */
export type GridViewState = {
  search: string;
  account: string;
  filters: Record<string, string>;
  period: Period;
  customFrom: string;
  customTo: string;
  sort: { id: string; desc: boolean }[];
  pageSize: number;
  pageIndex: number;
};

export const PAGE_SIZES = [25, 50, 100] as const;
/** "All" as a page size — large enough to never paginate a real book. */
export const PAGE_SIZE_ALL = 100_000;

export const DEFAULT_VIEW: GridViewState = {
  search: "",
  account: "all",
  filters: {},
  period: "all",
  customFrom: "",
  customTo: "",
  sort: [{ id: "date", desc: true }],
  pageSize: 50,
  pageIndex: 0,
};

const VIEW_KEY = "tj.trades.view.v1";

/**
 * Storage key per list. The grid renders on `/journal` AND inside each
 * playbook's Trades tab; one shared key made a filter set on one silently
 * narrow the other.
 */
export function viewStorageKey(viewKey?: string): string {
  return viewKey ? `${VIEW_KEY}:${viewKey}` : VIEW_KEY;
}

/**
 * Read back a stored view, trusting nothing about its shape: a value written by
 * an older build, or edited by hand, falls back field by field to the default.
 */
export function parseViewState(raw: string | null): GridViewState {
  if (!raw) return DEFAULT_VIEW;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_VIEW;
  }
  if (typeof v !== "object" || v == null) return DEFAULT_VIEW;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, d: string) => (typeof x === "string" ? x : d);
  const filters: Record<string, string> = {};
  if (typeof o.filters === "object" && o.filters != null) {
    for (const [k, val] of Object.entries(o.filters)) {
      if (typeof val === "string") filters[k] = val;
    }
  }
  const sort = Array.isArray(o.sort)
    ? o.sort.flatMap((s) =>
        s && typeof s.id === "string" && typeof s.desc === "boolean"
          ? [{ id: s.id, desc: s.desc }]
          : [],
      )
    : DEFAULT_VIEW.sort;
  const pageSize =
    typeof o.pageSize === "number" &&
    ((PAGE_SIZES as readonly number[]).includes(o.pageSize) || o.pageSize === PAGE_SIZE_ALL)
      ? o.pageSize
      : DEFAULT_VIEW.pageSize;
  const pageIndex =
    typeof o.pageIndex === "number" && Number.isInteger(o.pageIndex) && o.pageIndex >= 0
      ? o.pageIndex
      : 0;
  return {
    search: str(o.search, ""),
    account: str(o.account, "all"),
    filters,
    period: isPeriod(o.period) ? o.period : "all",
    customFrom: str(o.customFrom, ""),
    customTo: str(o.customTo, ""),
    sort,
    pageSize,
    pageIndex,
  };
}

export function loadViewState(viewKey?: string): GridViewState {
  try {
    return parseViewState(window.sessionStorage.getItem(viewStorageKey(viewKey)));
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveViewState(state: GridViewState, viewKey?: string): void {
  try {
    window.sessionStorage.setItem(viewStorageKey(viewKey), JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: the list still works, it just forgets.
  }
}
