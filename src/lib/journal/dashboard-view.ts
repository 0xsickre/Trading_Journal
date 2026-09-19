/**
 * The pure half of the dashboard's scope bar: which day a period opens on, and
 * the scope the page remembers for the tab.
 */

import { addDaysToDayKey, isoWeekdayOfDayKey } from "./time";

/**
 * Periods a trader actually thinks in. Rolling windows ("30d", "90d") were the
 * only choice, so "how is my week going" had no button; calendar periods sit
 * beside them now. The rolling values keep their numeric strings — they are
 * stored, and older code paths read them as a day count.
 */
export const DASHBOARD_PERIODS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All" },
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["value"];

export function isDashboardPeriod(v: unknown): v is DashboardPeriod {
  return DASHBOARD_PERIODS.some((p) => p.value === v);
}

/**
 * The first day of the window, as a day key in the account's zone — or null
 * for all time. Calendar periods start on their calendar boundary (Monday,
 * the 1st, 1 January); rolling ones count back from today inclusive, so "30d"
 * is thirty days including today, as it always was.
 */
export function periodStartKey(period: string, todayKey: string): string | null {
  switch (period) {
    case "all":
      return null;
    case "week":
      return addDaysToDayKey(todayKey, -(isoWeekdayOfDayKey(todayKey) - 1));
    case "month":
      return `${todayKey.slice(0, 7)}-01`;
    case "ytd":
      return `${todayKey.slice(0, 4)}-01-01`;
    default: {
      const n = Number(period);
      return Number.isInteger(n) && n > 0 ? addDaysToDayKey(todayKey, -(n - 1)) : null;
    }
  }
}

// --- Remembered scope -------------------------------------------------------

export type DashboardScope = {
  account: string;
  period: DashboardPeriod;
  mode: "net" | "gross";
  viewMode: "dollars" | "percentage" | "privacy";
};

const SCOPE_KEY = "tj.dashboard.scope.v1";
const VIEW_MODES = ["dollars", "percentage", "privacy"] as const;

/**
 * A stored scope, trusted field by field. Anything missing or malformed is
 * left out, so the caller keeps its own default for that field — the period's
 * default in particular depends on the book and is not a constant.
 */
export function parseScope(raw: string | null): Partial<DashboardScope> {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== "object" || v == null) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<DashboardScope> = {};
  if (typeof o.account === "string" && o.account) out.account = o.account;
  if (isDashboardPeriod(o.period)) out.period = o.period;
  if (o.mode === "net" || o.mode === "gross") out.mode = o.mode;
  if (VIEW_MODES.includes(o.viewMode as DashboardScope["viewMode"]))
    out.viewMode = o.viewMode as DashboardScope["viewMode"];
  return out;
}

export function loadScope(): Partial<DashboardScope> {
  try {
    return parseScope(window.sessionStorage.getItem(SCOPE_KEY));
  } catch {
    return {};
  }
}

export function saveScope(scope: DashboardScope): void {
  try {
    window.sessionStorage.setItem(SCOPE_KEY, JSON.stringify(scope));
  } catch {
    // Blocked storage: the page works, it just forgets.
  }
}
