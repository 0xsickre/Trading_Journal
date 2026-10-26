/**
 * The morning brief of one CME trading day, as the journal reads it.
 *
 * `futures-trading/tools/brief/brief.py` writes one `tj_session_briefs` row per
 * trading day (17:00 → 17:00 CT): the red windows around the day's news, the
 * end of day it flattens at, and the expected NQ / ES range. `/daily` shows it and two
 * tracker rules read it — `no_entry_in_red_window` (the windows, decision G7:
 * only the brief's own, no fixed fifteen minutes) and `flat_by_close` (the end
 * of day, earlier on a holiday or an early close).
 *
 * The row comes from another repo's script, so it is read as untrusted input: a
 * window that cannot be read is dropped and COUNTED, never guessed into shape,
 * and a range without a number is left out. Pure — no I/O here.
 */
import { addDaysToDayKey, cmeTradingDay, isValidDayKey, zonedInputToUtc } from "./time";

export type RedWindow = {
  /** ISO UTC, inclusive. */
  from: string;
  /** ISO UTC, inclusive. */
  to: string;
  title: string;
  /** The brief's importance ("visok", "srednji"), null when it gave none. */
  impact: string | null;
};

export type BriefRange = {
  /** Expected range, in the instrument's points (pips for 6E). */
  pts: number;
  /** The 80 % band around it; null when the brief gave none. */
  ptsLo: number | null;
  ptsHi: number | null;
  /** The same range as a percentage of price. */
  pct: number | null;
  unit: string;
};

export type SessionBrief = {
  tradingDay: string;
  /** The brief's end of day, ISO UTC; null when the exchange is closed that day. */
  flatBy: string | null;
  /** Why the day is special (holiday, early close), or null. */
  dayNote: string | null;
  redWindows: RedWindow[];
  /** Windows in the row that could not be read — said on screen, not hidden. */
  droppedWindows: number;
  ranges: Record<string, BriefRange>;
  sourceUrl: string | null;
};

/**
 * The brief's ordinary end of day, 15:10 Chicago — `futures-trading` writes it
 * on every day that is not a holiday or an early close, and prices a missed plan
 * up to it. Not the trader's flat-by time since phase X (that is the account's
 * `flat_by`); here it only tells an ordinary brief from an early close.
 */
export const BRIEF_FLAT_BY_CT = "15:10";

/** An account's flat-by time when it sets none (X-9 A): 16:00 Chicago, the CME's daily pause. */
export const DEFAULT_FLAT_BY_CT = "16:00";
const CHICAGO = "America/Chicago";

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function readWindow(v: unknown): RedWindow | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const from = isoOrNull(o.from);
  const to = isoOrNull(o.to);
  if (!from || !to || Date.parse(to) < Date.parse(from)) return null;
  return {
    from,
    to,
    title: typeof o.title === "string" && o.title.trim() !== "" ? o.title : "—",
    impact: typeof o.impact === "string" && o.impact !== "" ? o.impact : null,
  };
}

function readRange(v: unknown): BriefRange | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const pts = num(o.pts);
  if (pts == null) return null;
  return {
    pts,
    ptsLo: num(o.pts_lo),
    ptsHi: num(o.pts_hi),
    pct: num(o.pct),
    unit: typeof o.jedinica === "string" && o.jedinica !== "" ? o.jedinica : "pts",
  };
}

/** A `tj_session_briefs` row → a brief; null when the row names no real day. */
export function parseSessionBrief(row: unknown): SessionBrief | null {
  if (row == null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const day = typeof r.trading_day === "string" ? r.trading_day.slice(0, 10) : "";
  if (!isValidDayKey(day)) return null;

  const rawWindows = Array.isArray(r.red_windows) ? r.red_windows : [];
  const redWindows = rawWindows.map(readWindow).filter((w): w is RedWindow => w != null);
  redWindows.sort((a, b) => Date.parse(a.from) - Date.parse(b.from));

  const ranges: Record<string, BriefRange> = {};
  if (r.ranges != null && typeof r.ranges === "object" && !Array.isArray(r.ranges)) {
    for (const [k, v] of Object.entries(r.ranges as Record<string, unknown>)) {
      const range = readRange(v);
      if (range) ranges[k] = range;
    }
  }

  return {
    tradingDay: day,
    flatBy: isoOrNull(r.flat_by),
    dayNote: typeof r.day_note === "string" && r.day_note.trim() !== "" ? r.day_note : null,
    redWindows,
    droppedWindows: rawWindows.length - redWindows.length,
    ranges,
    sourceUrl: typeof r.source_url === "string" && r.source_url !== "" ? r.source_url : null,
  };
}

/** 15:10 on Chicago's clock on a trading day, ISO UTC. "" for an invalid day. */
export function defaultFlatBy(tradingDay: string): string {
  return flatByAt(tradingDay, BRIEF_FLAT_BY_CT);
}

/** `HH:MM` on Chicago's clock on a trading day, ISO UTC. "" for an invalid day or time. */
function flatByAt(tradingDay: string, hhmm: string): string {
  if (!isValidDayKey(tradingDay) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return "";
  return zonedInputToUtc(`${tradingDay}T${hhmm}`, CHICAGO) ?? "";
}

/**
 * The trading day a plan written at `iso` is for (F6, decision M3-A): the day it
 * falls in, or the next one when it was written after that day's 15:10 CT flat;
 * a Saturday or Sunday moves to Monday. The same rule `futures-trading` prices a
 * missed plan by (`journal_mae.py` `prozor_plana`). "" for an unreadable instant.
 */
export function planTradingDay(iso: string | null | undefined): string {
  let day = cmeTradingDay(iso);
  if (!day) return "";
  if (Date.parse(String(iso)) >= Date.parse(defaultFlatBy(day))) day = addDaysToDayKey(day, 1);
  for (let dow = new Date(`${day}T12:00:00Z`).getUTCDay(); dow === 0 || dow === 6; ) {
    day = addDaysToDayKey(day, 1);
    dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  }
  return day;
}

/** When a plan's trading day ends (its 15:10 CT flat), epoch ms; NaN for an unreadable instant. */
export function planDayEndsAt(iso: string | null | undefined): number {
  const day = planTradingDay(iso);
  return day ? Date.parse(defaultFlatBy(day)) : NaN;
}

/**
 * When a position has to be flat on a trading day (phase X, X-9 A).
 *
 * The account's own flat-by time (`tj_accounts.flat_by`, Chicago clock,
 * 16:00 when unset), unless the day's brief says the exchange closes EARLIER —
 * a holiday or an early close — or not at all. A brief that only states its
 * ordinary 15:10 is not an early close: that time was Topstep's, and the
 * trader's own time stands.
 */
export function flatByFor(
  tradingDay: string,
  brief: SessionBrief | null,
  accountFlatBy: string = DEFAULT_FLAT_BY_CT,
): { at: string | null; source: "brief" | "account" } {
  const own = flatByAt(tradingDay, accountFlatBy) || flatByAt(tradingDay, DEFAULT_FLAT_BY_CT);
  if (brief && brief.tradingDay === tradingDay) {
    if (brief.flatBy == null) return { at: null, source: "brief" };
    const early = Date.parse(brief.flatBy) < Date.parse(defaultFlatBy(tradingDay));
    if (early && (!own || Date.parse(brief.flatBy) < Date.parse(own))) return { at: brief.flatBy, source: "brief" };
  }
  return { at: own || null, source: "account" };
}

/** Each account's flat-by time by id; an unknown account, the default. */
export function flatByResolver(
  accounts: readonly { id: string; flat_by?: string | null }[],
): (accountId: string | null | undefined) => string {
  const byId = new Map(accounts.map((a) => [a.id, a.flat_by || DEFAULT_FLAT_BY_CT]));
  return (accountId) => (accountId ? (byId.get(accountId) ?? DEFAULT_FLAT_BY_CT) : DEFAULT_FLAT_BY_CT);
}

/** The red window an instant falls in, both edges included; null outside all of them. */
export function redWindowAt(
  instant: string | null | undefined,
  windows: readonly RedWindow[],
): RedWindow | null {
  const t = Date.parse(String(instant ?? ""));
  if (!Number.isFinite(t)) return null;
  return windows.find((w) => t >= Date.parse(w.from) && t <= Date.parse(w.to)) ?? null;
}

/** Briefs keyed by their trading day. */
export function briefResolver(briefs: readonly SessionBrief[]): (day: string) => SessionBrief | null {
  const byDay = new Map(briefs.map((b) => [b.tradingDay, b]));
  return (day) => byDay.get(day) ?? null;
}
