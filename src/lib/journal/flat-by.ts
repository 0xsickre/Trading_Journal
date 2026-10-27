/**
 * When a position has to be flat on a CME trading day, and which trading day a
 * plan is for.
 *
 * Until phase X9 (26.10.2026) this read the morning brief that
 * `futures-trading` wrote into `tj_session_briefs` (red windows, an early
 * close, the expected range). Since X-10 the brief is about the market only and
 * writes nothing here (trader: „brief treba da bude brief za tržište, ne za
 * journal“); the table and its rows stay as history, and nothing reads them.
 * The flat-by time is the account's own. Pure — no I/O here.
 */
import { addDaysToDayKey, cmeTradingDay, isValidDayKey, zonedInputToUtc } from "./time";

/**
 * The end of a plan's trading day, 15:10 Chicago: the horizon `futures-trading`
 * prices a missed plan up to (`journal_mae.py` `prozor_plana`). Not the trader's
 * flat-by time since phase X (that is the account's `flat_by`).
 */
const PLAN_DAY_END_CT = "15:10";

/** An account's flat-by time when it sets none (X-9 A): 16:00 Chicago, the CME's daily pause. */
export const DEFAULT_FLAT_BY_CT = "16:00";
const CHICAGO = "America/Chicago";

/** 15:10 on Chicago's clock on a trading day, ISO UTC. "" for an invalid day. */
function planDayEnd(tradingDay: string): string {
  return flatByAt(tradingDay, PLAN_DAY_END_CT);
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
  if (Date.parse(String(iso)) >= Date.parse(planDayEnd(day))) day = addDaysToDayKey(day, 1);
  for (let dow = new Date(`${day}T12:00:00Z`).getUTCDay(); dow === 0 || dow === 6; ) {
    day = addDaysToDayKey(day, 1);
    dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  }
  return day;
}

/** When a plan's trading day ends (its 15:10 CT flat), epoch ms; NaN for an unreadable instant. */
export function planDayEndsAt(iso: string | null | undefined): number {
  const day = planTradingDay(iso);
  return day ? Date.parse(planDayEnd(day)) : NaN;
}

/**
 * When a position has to be flat on a trading day (phase X, X-9 A): the
 * account's own flat-by time (`tj_accounts.flat_by`, Chicago clock, 16:00 when
 * unset). A holiday or an early close is not known here since X9 — the brief no
 * longer writes it — and the trader keeps it on the platform.
 */
export function flatByFor(tradingDay: string, accountFlatBy: string = DEFAULT_FLAT_BY_CT): string | null {
  return flatByAt(tradingDay, accountFlatBy) || flatByAt(tradingDay, DEFAULT_FLAT_BY_CT) || null;
}

/** Each account's flat-by time by id; an unknown account, the default. */
export function flatByResolver(
  accounts: readonly { id: string; flat_by?: string | null }[],
): (accountId: string | null | undefined) => string {
  const byId = new Map(accounts.map((a) => [a.id, a.flat_by || DEFAULT_FLAT_BY_CT]));
  return (accountId) => (accountId ? (byId.get(accountId) ?? DEFAULT_FLAT_BY_CT) : DEFAULT_FLAT_BY_CT);
}
