/**
 * Rules the tracker scores from data rather than asking about.
 *
 * After Phase 4 the database already knows whether a trade carried a playbook
 * and whether it had a stop, so asking the trader to tick those boxes is a
 * ritual, not a check. It also knows every realized loss, so the two money
 * limits are checkable too.
 *
 * The one thing that must not be got wrong here is WHICH DAY a trade belongs
 * to, because it differs per rule. Money is realized on the CLOSE day; a
 * decision about the setup is made on the OPEN day. Attribute either to the
 * wrong day and compliance is silently misfiled — no error, just a streak that
 * describes days you did not live.
 */

import { stringFieldValue } from "../field-values";
import { addDaysToDayKey, zonedDateKey } from "../time";
import { weekStartOfDayKey } from "../weekly-review";
import type { EquityLadder } from "./equity-ladder";
import type { AutoRuleKey } from "../tracker-types";
import type { TradeRow } from "../types";

export type { AutoRuleKey } from "../tracker-types";

export type AutoVerdict = "pass" | "fail" | "na";

export type AutoReason =
  | "ok"
  | "violated"
  /** No limit configured — the rule cannot say anything yet. */
  | "unconfigured"
  /** Nothing happened on this day that the rule could judge. */
  | "no_trades"
  /** A contributing trade has no price, so the answer is unknown. */
  | "unpriced"
  /**
   * No opening equity to take a percentage of.
   *
   * Distinct from `unconfigured`, which is the trader not having set a limit.
   * This is the limit being set and the BASIS being missing — no starting
   * balance recorded, or an unpriced trade earlier in the book that makes every
   * later balance unknowable. Different sentence, different fix.
   */
  | "no_equity"
  /** The day is locked; the verdict is the one frozen at lock time. */
  | "frozen";

export type AutoRuleResult = {
  key: AutoRuleKey;
  verdict: AutoVerdict;
  reason: AutoReason;
  /** Trade ids that broke the rule — the "show me" link on the row. */
  offenders: string[];
  /** Worst observed money for the loss rules; null otherwise. */
  observed: number | null;
  /**
   * The money the percentage worked out to on this day. Negative; null for
   * rules that are not money limits, or when the basis was unknown.
   *
   * Stored rather than recomputed in the UI because a percentage alone tells
   * the trader nothing about the day in front of them — "2 %" has to be said as
   * "240 EUR" against the balance the day actually opened with, and only the
   * evaluator knows what that balance was.
   */
  limit?: number | null;
};

/** Everything the evaluators need, and nothing else. */
export type TrackerTrade = {
  id: string;
  label: string;
  status: string;
  /** Account-timezone day the position was opened. */
  openDay: string;
  /** Account-timezone day it closed, null while still open. */
  closeDay: string | null;
  /** Null when `point_value_source` is 'missing' — price unknown, not zero. */
  netPl: number | null;
  hasPlaybook: boolean;
  hasStop: boolean;
  /** A non-empty `thesis` on the row — the reason for the trade, in writing. */
  hasThesis: boolean;
};

export type TradeDayIndex = {
  /** Decision-time rules: playbook link, stop loss. */
  byOpenDay: Map<string, TrackerTrade[]>;
  /** Money rules: per-trade and per-day loss. */
  byCloseDay: Map<string, TrackerTrade[]>;
};

export type AutoConfigs = Partial<Record<AutoRuleKey, { pct?: number }>>;

/**
 * Positions that count as executed discipline.
 *
 * `planned` and `missed` are plans and observations — grading them would
 * penalize the habit of logging setups you deliberately did not take.
 */
const EXECUTED_STATUSES: ReadonlySet<string> = new Set([
  "open",
  "partial",
  "closed",
]);

function toTrackerTrade(row: TradeRow, tz: string): TrackerTrade | null {
  const openedAt = row.stats?.opened_at ?? null;
  if (!openedAt) return null;
  return {
    id: row.id,
    label: row.trade_no != null ? `#${row.trade_no}` : row.id.slice(0, 8),
    status: String(row.status ?? ""),
    openDay: zonedDateKey(openedAt, tz),
    closeDay: row.stats?.closed_at ? zonedDateKey(row.stats.closed_at, tz) : null,
    netPl: row.stats?.net_pl ?? null,
    hasPlaybook: row.playbook_id != null && row.playbook_id !== "",
    hasStop: row.stop_price != null,
    // Trimmed: a thesis of three spaces is not a thesis, and storing one would
    // let the rule be satisfied by pressing the spacebar.
    hasThesis: (stringFieldValue(row, "thesis") ?? "").trim() !== "",
  };
}

/**
 * Index trades by both day definitions at once.
 *
 * An index rather than "pass me today's trades": there is no single set of
 * "day D's trades", so a caller that pre-filtered has already made the mistake
 * this module exists to prevent. It also turns a 182-day scan from O(days × N)
 * into O(N + days).
 */
export function buildTradeDayIndex(
  rows: TradeRow[],
  tzOf: (row: TradeRow) => string,
): TradeDayIndex {
  const byOpenDay = new Map<string, TrackerTrade[]>();
  const byCloseDay = new Map<string, TrackerTrade[]>();

  for (const row of rows) {
    if (!EXECUTED_STATUSES.has(String(row.status ?? ""))) continue;
    const t = toTrackerTrade(row, tzOf(row));
    if (!t || !t.openDay) continue;

    const open = byOpenDay.get(t.openDay) ?? [];
    open.push(t);
    byOpenDay.set(t.openDay, open);

    // An open position never lands in byCloseDay, so the money rules simply do
    // not see it. The asymmetry falls out of the attribution, with no
    // special-casing anywhere else.
    if (t.closeDay) {
      const close = byCloseDay.get(t.closeDay) ?? [];
      close.push(t);
      byCloseDay.set(t.closeDay, close);
    }
  }

  return { byOpenDay, byCloseDay };
}

const na = (key: AutoRuleKey, reason: AutoReason): AutoRuleResult => ({
  key,
  verdict: "na",
  reason,
  offenders: [],
  observed: null,
  limit: null,
});

/**
 * The money a percentage limit allows to be lost on a given day.
 *
 * Negative, because every comparison below is against a loss. `null` when
 * either half of the question is missing — no percentage configured, or an
 * opening equity that cannot be known — and the caller turns that into a rule
 * that is not scored rather than one that passes.
 */
function limitFor(pct: number | undefined, equity: number | null): number | null {
  if (pct == null || equity == null || equity <= 0) return null;
  return -(equity * Math.abs(pct)) / 100;
}

/**
 * Net max loss for the whole day, over trades CLOSED that day.
 *
 * Boundary is inclusive (`net <= limit`), matching `evaluateFtmo`: a day
 * exactly at your limit is a day you hit your limit.
 */
function evalMaxLossPerDay(
  trades: TrackerTrade[],
  pct: number | undefined,
  equity: number | null,
): AutoRuleResult {
  const key: AutoRuleKey = "max_loss_per_day";
  const limit = limitFor(pct, equity);
  if (limit == null) return na(key, pct == null ? "unconfigured" : "no_equity");
  if (trades.length === 0) return na(key, "no_trades");

  // Any unpriced trade makes the SUM unknown. The tempting shortcut — "if the
  // priced subset already breaks the limit, call it a fail" — is wrong: the
  // unknown trade may be a large winner that brings the day back above the
  // limit. The honest answer is that we do not know.
  if (trades.some((t) => t.netPl == null)) return na(key, "unpriced");

  const net = trades.reduce((s, t) => s + (t.netPl ?? 0), 0);
  const breached = net <= limit;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: breached ? trades.map((t) => t.id) : [],
    observed: net,
    limit,
  };
}

/**
 * Net max loss over the ISO week the day belongs to, up to and including it.
 *
 * SCORED EVERY DAY, not once on Sunday, and cumulatively from Monday. A weekly
 * budget you only hear about after the week is over is a report, not a limit —
 * the point is that Thursday can tell you the week is already spent. The same
 * week therefore fails on every day from the breach onwards, which is the
 * honest reading: the budget stayed blown.
 *
 * The week runs Monday–Sunday, the same one `/weekly` reviews, so the number
 * here and the number on the review page describe the same seven days.
 */
function evalMaxLossPerWeek(
  day: string,
  index: TradeDayIndex,
  pct: number | undefined,
  equity: number | null,
): AutoRuleResult {
  const key: AutoRuleKey = "max_loss_per_week";
  const limit = limitFor(pct, equity);
  if (limit == null) return na(key, pct == null ? "unconfigured" : "no_equity");

  const weekStart = weekStartOfDayKey(day);
  if (!weekStart) return na(key, "no_trades");

  const soFar: TrackerTrade[] = [];
  for (let d = weekStart; d <= day; d = addDaysToDayKey(d, 1)) {
    for (const t of index.byCloseDay.get(d) ?? []) soFar.push(t);
  }

  if (soFar.length === 0) return na(key, "no_trades");
  if (soFar.some((t) => t.netPl == null)) return na(key, "unpriced");

  const net = soFar.reduce((s, t) => s + (t.netPl ?? 0), 0);
  const breached = net <= limit;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: breached ? soFar.map((t) => t.id) : [],
    observed: net,
    limit,
  };
}

/**
 * Net max loss on any single trade closed that day.
 *
 * Diverges from the daily rule on unpriced trades, deliberately: this rule is
 * per trade, so an unknown trade clouds only itself. A priced trade that
 * breaches is a breach regardless of what the unknown one turns out to be.
 */
function evalMaxLossPerTrade(
  trades: TrackerTrade[],
  pct: number | undefined,
  equity: number | null,
): AutoRuleResult {
  const key: AutoRuleKey = "max_loss_per_trade";
  const limit = limitFor(pct, equity);
  if (limit == null) return na(key, pct == null ? "unconfigured" : "no_equity");
  if (trades.length === 0) return na(key, "no_trades");

  const priced = trades.filter((t) => t.netPl != null);
  const offenders = priced.filter((t) => (t.netPl as number) <= limit);

  if (offenders.length > 0) {
    return {
      key,
      verdict: "fail",
      reason: "violated",
      offenders: offenders.map((t) => t.id),
      observed: Math.min(...offenders.map((t) => t.netPl as number)),
      limit,
    };
  }
  // No priced trade breached, but an unpriced one might have.
  if (priced.length < trades.length) return na(key, "unpriced");

  return {
    key,
    verdict: "pass",
    reason: "ok",
    offenders: [],
    observed:
      priced.length > 0 ? Math.min(...priced.map((t) => t.netPl as number)) : null,
    limit,
  };
}

/** A yes/no property of every trade OPENED that day. */
function evalOpenDayFlag(
  key: AutoRuleKey,
  trades: TrackerTrade[],
  ok: (t: TrackerTrade) => boolean,
): AutoRuleResult {
  if (trades.length === 0) return na(key, "no_trades");
  const offenders = trades.filter((t) => !ok(t));
  return {
    key,
    verdict: offenders.length > 0 ? "fail" : "pass",
    reason: offenders.length > 0 ? "violated" : "ok",
    offenders: offenders.map((t) => t.id),
    observed: null,
  };
}

/**
 * Verdicts for one day.
 *
 * A day with no trades is `na`, never `pass`. "I did not exceed my max loss" is
 * vacuously true on a day you did not trade, and scoring it as a pass would let
 * a 200-day streak be farmed by NOT TRADING — the exact inversion of what the
 * metric is for. The disciplined no-trade day still scores 100 % on its
 * applicable rules, because `na` is dropped from the denominator and the manual
 * rules are perfectly answerable on such a day.
 */
export function evaluateAutoRulesForDay(
  day: string,
  index: TradeDayIndex,
  configs: AutoConfigs,
  /**
   * Equity the day opened with, for the percentage limits.
   *
   * Defaulted so the flag rules — which have no basis to speak of — can still
   * be evaluated by a caller that has no balance in hand. The money rules then
   * report `no_equity`, which is the truthful answer rather than a silent pass.
   */
  equityOf: EquityLadder = () => null,
): Record<AutoRuleKey, AutoRuleResult> {
  const closed = index.byCloseDay.get(day) ?? [];
  const opened = index.byOpenDay.get(day) ?? [];
  const equity = equityOf(day);

  return {
    max_loss_per_day: evalMaxLossPerDay(
      closed,
      configs.max_loss_per_day?.pct,
      equity,
    ),
    max_loss_per_trade: evalMaxLossPerTrade(
      closed,
      configs.max_loss_per_trade?.pct,
      equity,
    ),
    // The whole week to date, not just this day — see `evalMaxLossPerWeek`.
    max_loss_per_week: evalMaxLossPerWeek(
      day,
      index,
      configs.max_loss_per_week?.pct,
      equity,
    ),
    // Open day, not close day. Decisive counter-case: on close-day attribution a
    // still-open trade is INVISIBLE to the rule, so ten unlinked open trades
    // would report a perfect day.
    playbook_linked: evalOpenDayFlag("playbook_linked", opened, (t) => t.hasPlaybook),
    // Open day for the sharper reason: the point is that the stop existed WHEN
    // YOU ENTERED. Grading it on the close day grades it after the risk is gone.
    stop_loss_set: evalOpenDayFlag("stop_loss_set", opened, (t) => t.hasStop),
    // Open day, and for this rule it is not a nuance but the entire content of
    // it. A thesis written after the fact is a rationalisation — the check is
    // that the reason existed BEFORE the position did, and only the open day
    // can say that.
    thesis_written: evalOpenDayFlag("thesis_written", opened, (t) => t.hasThesis),
  };
}

/** Configs keyed by `auto_key`, for the evaluator. */
export function configsFromRules(
  rules: readonly { auto_key: AutoRuleKey | null; config: { pct?: number } }[],
): AutoConfigs {
  const out: AutoConfigs = {};
  for (const r of rules) {
    if (r.auto_key) out[r.auto_key] = r.config ?? {};
  }
  return out;
}
