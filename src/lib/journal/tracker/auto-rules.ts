/**
 * Rules the tracker scores from data rather than asking about.
 *
 * After Phase 4 the database already knows whether a trade carried a playbook
 * and whether it had a stop, so asking the trader to tick those boxes is a
 * ritual, not a check. It also knows every realized loss, so the Topstep
 * plan's money limits are checkable too.
 *
 * The one thing that must not be got wrong here is WHICH DAY a trade belongs
 * to, because it differs per rule. Money is realized on the CLOSE day; a
 * decision about the setup is made on the OPEN day. Attribute either to the
 * wrong day and compliance is silently misfiled — no error, just a streak that
 * describes days you did not live.
 */

import { rootOf, type BiasRoot } from "../default-instruments";
import { BIAS_CARD_SINCE, type DailyBias } from "../daily-bias";
import { numberFieldValue } from "../field-values";
import { computeFuturesContracts } from "../plan-calculations";
import { plannedEntryOf, sealedNumber, sealedText } from "../plan-snapshot";
import {
  riskBudgetAt,
  TOPSTEP_BREAKEVEN_R,
  topstepBreakevenBand,
  TOPSTEP_PLANS,
  TOPSTEP_SLIPPAGE_TOLERANCE,
  topstepMaxContracts,
  topstepStateAt,
  topstepPlanRulesFor,
  type TopstepRules,
  type TopstepTrade,
} from "../topstep";
import { tradeOutcome } from "../breakeven";
import { DEFAULT_TZ, dayKeyIn, zonedDateKey, zonedInputToUtc, type DayZone } from "../time";
import type { TradingWindow } from "./trading-window";
import { flatByFor, redWindowAt, type SessionBrief } from "../session-brief";
import { riskMoneyAtEntry } from "../risk-taken";
import type { AutoRuleKey } from "../tracker-types";
import type { TradeRow } from "../types";
import { GRADE_RATING, NO_MISTAKE } from "../quick-log";

export type { AutoRuleKey } from "../tracker-types";

export type AutoVerdict = "pass" | "fail" | "na";

export type AutoReason =
  | "ok"
  | "violated"
  /** The account has no personal daily profit target — `no_entry_after_daily_target` only. */
  | "unconfigured"
  /** Nothing happened on this day that the rule could judge. */
  | "no_trades"
  /**
   * Trades were opened, but none of them was written as a plan before its
   * entry — so there was no moment at which a reason could have been written
   * beforehand. `thesis_written` only.
   */
  | "no_plans"
  /** A contributing trade has no price, so the answer is unknown. */
  | "unpriced"
  /** The day is locked; the verdict is the one frozen at lock time. */
  | "frozen"
  /** A rule that reads the morning brief, on a day the brief did not reach the journal. */
  | "no_brief"
  /** The brief says the exchange was closed that day — there is no close to be flat by. */
  | "market_closed"
  /** A Topstep position still open, and the close not reached yet. */
  | "not_yet"
  /** A Topstep rule, on a day that had no Topstep trade. */
  | "no_topstep_trades";

/** Which of the Topstep plan's numbers a money limit is. */
export type LimitBasis =
  | "topstep_dll"
  /** The trader's TopstepX Personal Daily Loss Limit, tighter than the plan's. */
  | "personal_dll"
  | "topstep_budget"
  | "topstep_budget_slippage"
  /** The trader's TopstepX Personal Daily Profit Target. */
  | "daily_target";

export type AutoRuleResult = {
  key: AutoRuleKey;
  verdict: AutoVerdict;
  reason: AutoReason;
  /** Trade ids that broke the rule — the "show me" link on the row. */
  offenders: string[];
  /** Worst observed money for the loss rules; null otherwise. */
  observed: number | null;
  /**
   * The money the rule allowed on this day: the plan's DLL, or the budget the
   * risk rule gave at entry. Negative for a loss limit; null for rules that
   * are not money limits, or when the budget was unknown.
   */
  limit?: number | null;
  /** Which Topstep number `limit` is. */
  basis?: LimitBasis;
  /** `flat_by_close`: the close the day was graded against, ISO UTC. */
  at?: string | null;
  /** `no_entry_in_red_window`: the window of the first offending entry. */
  window?: string;
  /** `stop_after_two_losses`: the longest losing run an entry followed, against the limit. */
  counted?: { observed: number; limit: number };
  /** `playbook_linked`: offenders whose playbook was created after their entry (phase Y). */
  lateLinks?: string[];
};

/** Everything the evaluators need, and nothing else. */
export type TrackerTrade = {
  id: string;
  accountId: string | null;
  label: string;
  status: string;
  /** Instants, ISO — the order of entries and exits within a day is the whole of two rules. */
  openedAt: string;
  closedAt: string | null;
  /** Account-timezone day the position was opened. */
  openDay: string;
  /** The daily-bias root of the instrument (MNQ → NQ); null for one with no daily bias (phase D). */
  biasRoot: BiasRoot | null;
  /** Account-timezone day it closed, null while still open. */
  closeDay: string | null;
  /** Null when `point_value_source` is 'missing' — price unknown, not zero. */
  netPl: number | null;
  /**
   * A stop loss: below the breakeven band (on a Topstep account a tenth of the
   * trade's risk, K4), not merely below zero — a scratch is not a stop. Null
   * when the price is unknown.
   */
  isLoss: boolean | null;
  hasPlaybook: boolean;
  /**
   * The linked playbook was created after the first fill (phase Y, Y-1 = A): a
   * playbook written once the outcome was known is a story, not a plan. False
   * when the creation time is unknown — not knowing is not a breach.
   */
  playbookLate: boolean;
  hasStop: boolean;
  /** A non-empty `thesis` in the SEALED plan — the reason, written beforehand. */
  hasThesis: boolean;
  /**
   * The row existed before its first fill: `created_at <= opened_at`.
   *
   * A plan-first trade, and a resting plan the import later filled, were
   * written before the position; a trade logged after the close, or created by
   * the import, was written after it — its seal is stamped at the moment of
   * writing, so it cannot say whether a reason existed beforehand.
   */
  plannedBeforeEntry: boolean;
  /**
   * Risk taken at entry, in account currency. Null when any factor is unknown
   * — no stop, or an unpriced instrument.
   */
  riskMoney: number | null;
  /**
   * Whether the size was the contract count the risk rule gave at entry. Null
   * when either half is unknown, which is not the same as "no".
   */
  matchedIntent: boolean | null;
  /**
   * On a Topstep account, the plan's money rules this trade is graded by; null
   * on any other account, which no money rule grades.
   */
  topstep: {
    /** The day's Daily Loss Limit, positive: the plan's, or the personal one where tighter. */
    dll: number;
    /** Whether `dll` is the trader's personal limit. */
    personalDll: boolean;
    /** The personal daily profit target, positive; null when the account sets none. */
    dailyTarget: number | null;
    /**
     * What the risk rule allowed at entry: `risk_budget_at_entry` as sealed,
     * else derived from the account's closed trades at that moment. Null only
     * when the entry instant cannot be read.
     */
    budget: number | null;
  } | null;
  /**
   * What the trader wrote on the trade page (phase Q), read LIVE: these rules
   * ask whether the review was done, and a review is written after the close.
   */
  review: TradeReview;
};

/** The trade page's answers the phase-Q rules read. */
export type TradeReview = {
  /** `custom.htf_bias` as chosen, trimmed; null when empty. */
  htfBias: string | null;
  /** `thesis` (what was said before the click) is written. */
  thesis: boolean;
  /** `execution_rating`: A = 5, B = 3, C = 1 (`GRADE_RATING`); null when ungraded. */
  grade: number | null;
  exitReason: boolean;
  /** `custom.entry_tf` is chosen. */
  entryTf: boolean;
  psychology: string[];
  mistakes: string[];
  /** Charts on the trade (`tj_trade_images`). */
  images: number;
};

/** Psychology tag that claims the risk was respected. */
export const RESPECTED_RISK_TAG = "Ispoštovao rizik";

/** Psychology tag that claims the trade was managed by a plan (phase Y5). */
export const LED_BY_PLAN_TAG = "Vodio po planu";

/** Rules whose breach on a trade makes "Ispoštovao rizik" on it untrue. */
const RISK_RULES: readonly AutoRuleKey[] = ["risk_per_trade", "stop_loss_set", "max_loss_per_trade"];

/** Rules about the review itself: their breach is a gap in the journal, not a trading error. */
const REVIEW_RULES: ReadonlySet<AutoRuleKey> = new Set<AutoRuleKey>([
  "honest_tags",
  "review_complete",
  "screenshot_per_trade",
  "thesis_recorded",
]);

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== "") : [];

const customText = (row: TradeRow, key: string): string | null => {
  const custom = (row as { custom?: Record<string, unknown> | null }).custom;
  const v = custom?.[key];
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

function reviewOf(row: TradeRow): TradeReview {
  const r = row as TradeRow & {
    thesis?: string | null;
    exit_reason?: string | null;
    psychology_tags?: unknown;
    mistake?: unknown;
    chart_images?: unknown;
  };
  return {
    htfBias: customText(row, "htf_bias"),
    thesis: String(r.thesis ?? "").trim() !== "",
    grade: numberFieldValue(row, "execution_rating"),
    exitReason: String(r.exit_reason ?? "").trim() !== "",
    entryTf: customText(row, "entry_tf") != null,
    psychology: list(r.psychology_tags),
    mistakes: list(r.mistake),
    images: Array.isArray(r.chart_images) ? r.chart_images.length : 0,
  };
}

/** "Nisam odredio unapred" (any capitalisation) is the answer that there was no bias. */
export const biasWasSet = (bias: string | null): boolean => bias != null && !/^nisam odredio/i.test(bias);

export type TradeDayIndex = {
  /** Decision-time rules: playbook link, stop loss. */
  byOpenDay: Map<string, TrackerTrade[]>;
  /** Money rules: per-trade and per-day loss. */
  byCloseDay: Map<string, TrackerTrade[]>;
};

/**
 * What the day-trading rules read besides the trades: the morning brief of a
 * Topstep day, and the present moment (a position still open is only late once
 * the close has passed). Both optional — a caller without them gets `no_brief`
 * and the default 15:10 CT close, never a guess.
 */
export type AutoContext = {
  briefOf?: (day: string) => SessionBrief | null;
  /** Epoch ms; defaults to the moment of evaluation. */
  now?: number;
  /** The trading window in force on a day (phase Y4, `tradingWindowResolver`); none = unconfigured. */
  tradingWindowOf?: (day: string) => TradingWindow | null;
  /** The day's counted bias forecast per root (phase D, `firstBiasResolver`); none = no card read. */
  biasOf?: (day: string, root: BiasRoot) => DailyBias | null;
};

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

/** A Topstep account's rules and its closed trades, for budgets derived at entry. */
type TopstepBook = { rules: TopstepRules; closed: TopstepTrade[] };

/**
 * The contracts the trade form would have sized this entry to: the budget at
 * entry, the sealed stop, the commission, the plan's cap — `computeFuturesContracts`,
 * the call the form makes. Null when any input is missing.
 */
function expectedContracts(row: TradeRow, budget: number | null, book: TopstepBook): number | null {
  const stats = row.stats;
  if (budget == null || !stats) return null;
  const qty = stats.entry_qty ?? 0;
  const pointValue = (stats.point_value ?? 0) * (stats.fx_rate ?? 1);
  const out = computeFuturesContracts({
    riskAmount: budget,
    entry: plannedEntryOf(row) ?? stats.avg_entry,
    stop: sealedNumber(row, "stop_price"),
    pointValue: pointValue > 0 ? pointValue : null,
    // Per side and per contract, as the form counts it: the trade's fees are
    // both sides of every contract.
    commissionPerSide: qty > 0 ? (stats.total_fees ?? 0) / (2 * qty) : 0,
    // The account's size at the entry: on an XFA the Scaling Plan tier of that session (phase T).
    maxContracts: topstepMaxContracts(
      topstepStateAt(book.rules.config, book.closed, stats.opened_at ?? "")?.rules ?? TOPSTEP_PLANS[book.rules.config.plan],
      typeof row.instrument === "string" ? row.instrument : null,
    ),
    // The tick frozen on the trade when it was written, as the form read it then.
    tickSize: numberFieldValue(row, "tick_size_at_trade"),
  });
  return out?.contracts ?? null;
}

function topstepOfTrade(book: TopstepBook, budget: number | null): NonNullable<TrackerTrade["topstep"]> {
  const dll = topstepPlanRulesFor(book.rules.config).dll;
  return {
    dll,
    personalDll: dll !== TOPSTEP_PLANS[book.rules.config.plan].dll,
    dailyTarget: book.rules.config.dailyTarget,
    budget,
  };
}

function toTrackerTrade(row: TradeRow, zone: DayZone, book: TopstepBook | null): TrackerTrade | null {
  const openedAt = row.stats?.opened_at ?? null;
  if (!openedAt) return null;
  const budget = book
    ? (numberFieldValue(row, "risk_budget_at_entry") ??
      riskBudgetAt(book.rules.config, book.rules.risk, book.closed, openedAt))
    : null;
  const expected = book ? expectedContracts(row, budget, book) : null;
  return {
    id: row.id,
    accountId: row.account_id,
    label: row.trade_no != null ? `#${row.trade_no}` : row.id.slice(0, 8),
    status: String(row.status ?? ""),
    openedAt,
    closedAt: row.stats?.closed_at ?? null,
    openDay: dayKeyIn(openedAt, zone),
    biasRoot: rootOf(typeof row.instrument === "string" ? row.instrument : null),
    closeDay: row.stats?.closed_at ? dayKeyIn(row.stats.closed_at, zone) : null,
    netPl: row.stats?.net_pl ?? null,
    isLoss:
      row.stats?.net_pl == null
        ? null
        : book
          ? tradeOutcome(row, row.stats.net_pl, {
              from: -topstepBreakevenBand(book.rules.config.plan),
              to: topstepBreakevenBand(book.rules.config.plan),
              riskShare: TOPSTEP_BREAKEVEN_R,
            }) === "loss"
          : row.stats.net_pl < 0,
    hasPlaybook: row.playbook_id != null && row.playbook_id !== "",
    playbookLate:
      row.playbook_id != null &&
      row.playbook_id !== "" &&
      Date.parse(String(row.playbook_created_at ?? "")) > Date.parse(openedAt),
    hasStop: sealedNumber(row, "stop_price") != null,
    // Both read the SEALED plan, which is the whole content of these two rules:
    // they ask whether the stop and the reason existed before the position did.
    // Read live, a thesis typed after the close would satisfy "thesis written"
    // — the rationalisation the rule exists to catch.
    //
    // Trimmed: a thesis of three spaces is not a thesis, and storing one would
    // let the rule be satisfied by pressing the spacebar.
    hasThesis: (sealedText(row, "thesis") ?? "").trim() !== "",
    plannedBeforeEntry: createdBy(row.created_at, openedAt),
    riskMoney: riskMoneyAtEntry(row),
    // The intent is the rule's budget, and a whole-contract size can only
    // match it by being the count the form would have given.
    matchedIntent: expected == null ? null : (row.stats?.entry_qty ?? null) === expected,
    topstep: book ? topstepOfTrade(book, budget) : null,
    review: reviewOf(row),
  };
}

/**
 * Whether a row was created no later than an instant.
 *
 * Compared as instants, not strings: Postgres and the stats view do not promise
 * the same offset notation. An unreadable timestamp answers false, which makes
 * the trade ungraded (`na`) rather than failed — not knowing is not a breach.
 */
function createdBy(createdAt: string | null | undefined, instant: string): boolean {
  const c = Date.parse(String(createdAt ?? ""));
  const o = Date.parse(instant);
  return Number.isFinite(c) && Number.isFinite(o) && c <= o;
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
  /** The account's day rule — a Topstep account counts Topstep's trading day. */
  tzOf: (row: TradeRow) => DayZone,
  /** A Topstep account's rules; null for every other account. */
  topstepOf: (accountId: string | null) => TopstepRules | null = () => null,
): TradeDayIndex {
  const byOpenDay = new Map<string, TrackerTrade[]>();
  const byCloseDay = new Map<string, TrackerTrade[]>();

  // Each Topstep account's closed trades, once: a budget derived at entry is the
  // account's state at that moment, read off everything that had closed before.
  const books = new Map<string, TopstepBook>();
  for (const row of rows) {
    const rules = topstepOf(row.account_id);
    if (!rules || !row.account_id) continue;
    const book = books.get(row.account_id) ?? { rules, closed: [] };
    if (row.status === "closed" && row.stats?.net_pl != null) {
      book.closed.push({ closedAt: row.stats.closed_at, net: row.stats.net_pl });
    }
    books.set(row.account_id, book);
  }

  for (const row of rows) {
    if (!EXECUTED_STATUSES.has(String(row.status ?? ""))) continue;
    const t = toTrackerTrade(row, tzOf(row), (row.account_id && books.get(row.account_id)) || null);
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

// --- The Topstep plan's money, per account (F3, E1–E5; H2, I4) -----------------
//
// The limits are money from the account's plan, and they belong to that
// ACCOUNT: two 50Ks each down 600 are two survived days, not one lost 1 200. So
// a rule's trades are split per Topstep account, each part is graded, and the
// parts are folded into one verdict. A trade on any other account is not
// graded by a money rule at all — the book is Topstep only since H2.

/** How close a result came to its limit: observed ÷ limit, same sign on both sides. */
function usage(r: AutoRuleResult): number {
  if (r.observed == null || r.limit == null) return 0;
  if (r.limit === 0) return r.observed === 0 ? 0 : Infinity;
  return r.observed / r.limit;
}

const worstOf = (rs: AutoRuleResult[]): AutoRuleResult =>
  rs.reduce((a, b) => (usage(b) > usage(a) ? b : a));

/**
 * One verdict from the parts of a rule: any part broken breaks the day (its
 * offenders are the ones to open, and the numbers shown are the worst breach's);
 * a part whose answer is unknown leaves the rest unknown too, as an unpriced
 * trade does inside one part; otherwise the day passed, and shows the part that
 * came nearest its limit. A part with nothing to grade drops out.
 */
function combine(key: AutoRuleKey, parts: AutoRuleResult[]): AutoRuleResult {
  const fails = parts.filter((p) => p.verdict === "fail");
  if (fails.length > 0) {
    const w = worstOf(fails);
    return {
      key,
      verdict: "fail",
      reason: "violated",
      offenders: fails.flatMap((p) => p.offenders),
      observed: w.observed,
      limit: w.limit ?? null,
      ...(w.basis ? { basis: w.basis } : {}),
    };
  }
  if (parts.some((p) => p.verdict === "na" && p.reason === "unpriced")) return na(key, "unpriced");
  const passes = parts.filter((p) => p.verdict === "pass");
  if (passes.length > 0) {
    const w = worstOf(passes);
    return {
      key,
      verdict: "pass",
      reason: "ok",
      offenders: [],
      observed: w.observed,
      limit: w.limit ?? null,
      ...(w.basis ? { basis: w.basis } : {}),
    };
  }
  return parts[0] ?? na(key, "no_trades");
}

/** Topstep trades grouped by their account, in first-seen order. */
function byTopstepAccount(trades: TrackerTrade[]): TrackerTrade[][] {
  const groups = new Map<string, TrackerTrade[]>();
  for (const t of trades) {
    if (!t.topstep) continue;
    const k = t.accountId ?? "";
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()];
}

/** One Topstep account's day against its DLL (the personal one where tighter) — inclusive, as Topstep counts it. */
function topstepDayLoss(trades: TrackerTrade[]): AutoRuleResult {
  const key: AutoRuleKey = "max_loss_per_day";
  if (trades.some((t) => t.netPl == null)) return na(key, "unpriced");
  const net = trades.reduce((s, t) => s + (t.netPl ?? 0), 0);
  const ts = trades[0].topstep as NonNullable<TrackerTrade["topstep"]>;
  const limit = -ts.dll;
  const breached = net <= limit;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: breached ? trades.map((t) => t.id) : [],
    observed: net,
    limit,
    basis: ts.personalDll ? "personal_dll" : "topstep_dll",
  };
}

/** One Topstep trade's loss against its budget at entry, plus the slippage tolerance (E3). */
function topstepTradeLoss(t: TrackerTrade): AutoRuleResult {
  const key: AutoRuleKey = "max_loss_per_trade";
  const budget = t.topstep?.budget ?? null;
  if (budget == null || t.netPl == null) return na(key, "unpriced");
  const limit = -budget * (1 + TOPSTEP_SLIPPAGE_TOLERANCE);
  // A loss, not a flat trade: with no budget at all, breakeven is not a breach.
  const breached = t.netPl < 0 && t.netPl <= limit;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: breached ? [t.id] : [],
    observed: t.netPl,
    limit,
    basis: "topstep_budget_slippage",
  };
}

/** One Topstep entry's risk against the budget the rule allowed at that moment. */
function topstepRisk(t: TrackerTrade): AutoRuleResult {
  const key: AutoRuleKey = "risk_per_trade";
  const budget = t.topstep?.budget ?? null;
  if (budget == null || t.riskMoney == null) return na(key, "unpriced");
  const breached = t.riskMoney > budget + 1e-9;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: breached ? [t.id] : [],
    observed: t.riskMoney,
    limit: budget,
    basis: "topstep_budget",
  };
}

/** A money rule's parts, or why there are none: no trade, or none on Topstep. */
function topstepParts(
  key: AutoRuleKey,
  trades: TrackerTrade[],
  grade: (ts: TrackerTrade[]) => AutoRuleResult[],
): AutoRuleResult {
  if (trades.length === 0) return na(key, "no_trades");
  const topstep = trades.filter((t) => t.topstep);
  if (topstep.length === 0) return na(key, "no_topstep_trades");
  return combine(key, grade(topstep));
}

const evalMaxLossPerDay = (trades: TrackerTrade[]) =>
  topstepParts("max_loss_per_day", trades, (ts) => byTopstepAccount(ts).map(topstepDayLoss));

const evalMaxLossPerTrade = (trades: TrackerTrade[]) =>
  topstepParts("max_loss_per_trade", trades, (ts) => ts.map(topstepTradeLoss));

const evalRiskPerTrade = (trades: TrackerTrade[]) =>
  topstepParts("risk_per_trade", trades, (ts) => ts.map(topstepRisk));

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
 * `playbook_linked`: every trade opened that day carries a playbook that
 * existed when it was entered. One linked afterwards fails like an unlinked
 * one, and is named in `lateLinks` so the day can say which was which.
 */
function evalPlaybookLinked(trades: TrackerTrade[]): AutoRuleResult {
  const res = evalOpenDayFlag("playbook_linked", trades, (t) => t.hasPlaybook && !t.playbookLate);
  const late = trades.filter((t) => t.hasPlaybook && t.playbookLate).map((t) => t.id);
  return late.length > 0 ? { ...res, lateLinks: late } : res;
}

/**
 * `thesis_written`, over the trades that were planned before their entry.
 *
 * A trade written after the fact had no "before" in which a thesis could have
 * existed, so it is not graded at all — neither a fail (the trader recorded a
 * trade, which is not a breach) nor a pass (nothing was checked). A day on
 * which every trade was logged afterwards is therefore `na` with `no_plans`,
 * not `pass`: the same reasoning that makes a day with no trades `na`.
 *
 * Rejected alternative: writing the quick log's sentence into `thesis`. It
 * would be sealed as the reason before entry while written after the close —
 * the very rationalisation the rule reads the seal to catch.
 */
function evalThesisWritten(trades: TrackerTrade[]): AutoRuleResult {
  const key: AutoRuleKey = "thesis_written";
  if (trades.length === 0) return na(key, "no_trades");
  const planned = trades.filter((t) => t.plannedBeforeEntry);
  if (planned.length === 0) return na(key, "no_plans");
  return evalOpenDayFlag(key, planned, (t) => t.hasThesis);
}

/**
 * Was each entry sized to the contract count the risk rule gave at entry?
 *
 * Not an `evalOpenDayFlag`, because "unknown" is a third answer here: a trade
 * with no stop, an unpriced instrument or no budget cannot be judged, and a
 * flag rule would count it as a miss. A day whose every trade is unmeasurable
 * is `na`, not a fail.
 *
 * The offenders carry the finding — they are the trades to open.
 */
function evalRiskMatchedIntent(trades: TrackerTrade[]): AutoRuleResult {
  const key: AutoRuleKey = "risk_matched_intent";
  if (trades.length === 0) return na(key, "no_trades");

  const judged = trades.filter((t) => t.matchedIntent != null);
  const offenders = judged.filter((t) => t.matchedIntent === false);

  if (offenders.length > 0) {
    return {
      key,
      verdict: "fail",
      reason: "violated",
      offenders: offenders.map((t) => t.id),
      observed: null,
      limit: null,
    };
  }
  if (judged.length < trades.length) return na(key, "unpriced");

  return { key, verdict: "pass", reason: "ok", offenders: [], observed: null, limit: null };
}

// --- The trade page's rules (phase Q, 14.10.2026) ------------------------------

/**
 * A review rule over the trades opened that day and already CLOSED: a review is
 * written after the exit, so a position still open is not yet a gap. A day whose
 * every trade is still open is `not_yet`.
 */
function evalReview(key: AutoRuleKey, opened: TrackerTrade[], ok: (t: TrackerTrade) => boolean): AutoRuleResult {
  if (opened.length === 0) return na(key, "no_trades");
  const done = opened.filter((t) => t.closedAt != null);
  if (done.length === 0) return na(key, "not_yet");
  return evalOpenDayFlag(key, done, ok);
}

/**
 * Every trade has the day's bias, set beforehand.
 *
 * From `BIAS_CARD_SINCE` (phase D, D-6) the bias is the /daily card's FIRST forecast for the trade's
 * root, and it must have been set no later than the entry — graded at entry, like the stop, since it
 * is a decision taken before the click. An instrument with no daily bias (6E) and the days before the
 * card keep the trade page's field, as reviewed after the close.
 */
function evalHtfBiasSet(day: string, opened: TrackerTrade[], ctx: Required<AutoContext>): AutoRuleResult {
  if (day < BIAS_CARD_SINCE) return evalReview("htf_bias_set", opened, (t) => biasWasSet(t.review.htfBias));
  return evalOpenDayFlag("htf_bias_set", opened, (t) => {
    if (t.biasRoot == null) return biasWasSet(t.review.htfBias);
    const b = ctx.biasOf(t.openDay, t.biasRoot);
    return b != null && Date.parse(b.setAt) <= Date.parse(t.openedAt);
  });
}

/** The trade's bias is known: the card's forecast from `BIAS_CARD_SINCE`, else the trade page's field. */
function biasKnown(day: string, t: TrackerTrade, ctx: Required<AutoContext>): boolean {
  if (day < BIAS_CARD_SINCE || t.biasRoot == null) return t.review.htfBias != null;
  return ctx.biasOf(t.openDay, t.biasRoot) != null;
}

/** What was said before the click is written on every trade. When it was said, the recording tells. */
const evalThesisRecorded = (opened: TrackerTrade[]) =>
  evalReview("thesis_recorded", opened, (t) => t.review.thesis);

/** Grade, exit reason, bias, Entry TF, a feeling, and a mistake or an A. */
const evalReviewComplete = (day: string, opened: TrackerTrade[], ctx: Required<AutoContext>) =>
  evalReview(
    "review_complete",
    opened,
    (t) =>
      t.review.grade != null &&
      t.review.exitReason &&
      biasKnown(day, t, ctx) &&
      t.review.entryTf &&
      t.review.psychology.length > 0 &&
      (t.review.mistakes.length > 0 || t.review.grade === GRADE_RATING.A),
  );

const evalScreenshotPerTrade = (opened: TrackerTrade[]) =>
  evalReview("screenshot_per_trade", opened, (t) => t.review.images > 0);

/**
 * Honest tags, per trade: a tag that a failed rule on THE SAME trade says is
 * untrue. "Ispoštovao rizik" beside a broken risk or stop rule; an A — which
 * the trade page records as "Bez greške" — beside any broken trading rule. The
 * review rules are left out: an unfinished review is not a trading error.
 */
function evalHonestTags(opened: TrackerTrade[], results: Partial<Record<AutoRuleKey, AutoRuleResult>>): AutoRuleResult {
  const offendersOf = (keys: readonly AutoRuleKey[]) =>
    new Set(keys.flatMap((k) => (results[k]?.verdict === "fail" ? results[k]!.offenders : [])));
  const risk = offendersOf(RISK_RULES);
  const any = offendersOf((Object.keys(results) as AutoRuleKey[]).filter((k) => !REVIEW_RULES.has(k)));
  return evalReview("honest_tags", opened, (t) => {
    const claimsRisk = t.review.psychology.includes(RESPECTED_RISK_TAG);
    const claimsClean = t.review.grade === GRADE_RATING.A || t.review.mistakes.includes(NO_MISTAKE);
    // Phase Y5: "Vodio po planu" claims a plan, which needs a playbook that existed at entry.
    const claimsPlan = t.review.psychology.includes(LED_BY_PLAN_TAG);
    const hadPlan = t.hasPlaybook && !t.playbookLate;
    return !(claimsRisk && risk.has(t.id)) && !(claimsClean && any.has(t.id)) && !(claimsPlan && !hadPlan);
  });
}

// --- The day trader's rules (F4: G5, G7, G9) -----------------------------------

const MINUTE_MS = 60_000;

/**
 * Every entry, and every exit, inside the day's trading window on the trader's
 * clock (phase Y4). An entry before `from` or from `to` on breaks it; so does a
 * position still open once the minute of `to` has passed. An exit within that
 * minute is the time exit the window asks for, not a breach. A position still
 * open before then is not a breach yet. No window for the day: `unconfigured`.
 */
function evalTradingWindow(
  day: string,
  opened: TrackerTrade[],
  ctx: Required<AutoContext>,
): AutoRuleResult {
  const key: AutoRuleKey = "trading_window";
  if (opened.length === 0) return na(key, "no_trades");
  const w = ctx.tradingWindowOf(day);
  if (!w) return na(key, "unconfigured");
  const offenders = opened.filter((t) => {
    const date = zonedDateKey(t.openedAt, DEFAULT_TZ);
    const start = epoch(zonedInputToUtc(`${date}T${w.from}`, DEFAULT_TZ));
    const end = epoch(zonedInputToUtc(`${date}T${w.to}`, DEFAULT_TZ));
    const entry = epoch(t.openedAt);
    if (entry < start || entry >= end) return true;
    const out = t.closedAt != null ? epoch(t.closedAt) : ctx.now;
    return out >= end + MINUTE_MS;
  });
  return {
    key,
    verdict: offenders.length > 0 ? "fail" : "pass",
    reason: offenders.length > 0 ? "violated" : "ok",
    offenders: offenders.map((t) => t.id),
    observed: null,
    limit: null,
    window: `${w.from}–${w.to}`,
  };
}

const epoch = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));
const byOpened = (a: TrackerTrade, b: TrackerTrade) => epoch(a.openedAt) - epoch(b.openedAt);

/**
 * No entry once the account's day has banked its personal daily profit target
 * (TopstepX's Personal Daily Profit Target, 30.09.2026) — the day stops on
 * money, never on a count of trades.
 *
 * The day's money is what had CLOSED on that account before the entry, as with
 * any decision taken at entry. A trade with no price among them leaves the
 * entries after it unknown: it may be the one that reached the target.
 */
function evalNoEntryAfterDailyTarget(opened: TrackerTrade[], closedToday: TrackerTrade[]): AutoRuleResult {
  const key: AutoRuleKey = "no_entry_after_daily_target";
  if (opened.length === 0) return na(key, "no_trades");
  const topstep = opened.filter((t) => t.topstep);
  if (topstep.length === 0) return na(key, "no_topstep_trades");
  const graded = topstep.filter((t) => t.topstep?.dailyTarget != null);
  if (graded.length === 0) return na(key, "unconfigured");
  const offenders: string[] = [];
  let unknown = false;
  let first: { observed: number; limit: number } | null = null;
  let best: { observed: number; limit: number } | null = null;
  for (const t of [...graded].sort(byOpened)) {
    const target = t.topstep!.dailyTarget!;
    const before = closedToday.filter(
      (c) => c.id !== t.id && c.accountId === t.accountId && epoch(c.closedAt) < epoch(t.openedAt),
    );
    if (before.some((c) => c.netPl == null)) {
      unknown = true;
      continue;
    }
    const banked = before.reduce((s, c) => s + (c.netPl ?? 0), 0);
    if (banked >= target) {
      offenders.push(t.id);
      first ??= { observed: banked, limit: target };
    } else if (best == null || banked / target > best.observed / best.limit) {
      best = { observed: banked, limit: target };
    }
  }
  if (offenders.length === 0 && unknown) return na(key, "unpriced");
  const shown = first ?? best;
  const breached = offenders.length > 0;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders,
    observed: shown?.observed ?? null,
    limit: shown?.limit ?? null,
    basis: "daily_target",
  };
}

/** Two stop losses in a row end the day (08.10.2026). */
export const STOP_AFTER_LOSSES = 2;

/**
 * No entry after two stop losses IN A ROW on the same account and day
 * (trader, 08.10.2026: "2 SL kraj, ali uzastopna — ako jednu dobijem nakon
 * gubitka nije kraj").
 *
 * The run is read from the trades CLOSED before the entry, newest first: it
 * counts losses and stops at the first trade that is not one — a win or a
 * scratch inside the breakeven band breaks it. A trade with no price stops the
 * count as unknown: it might have been the second loss.
 */
function evalStopAfterTwoLosses(opened: TrackerTrade[], closedToday: TrackerTrade[]): AutoRuleResult {
  const key: AutoRuleKey = "stop_after_two_losses";
  if (opened.length === 0) return na(key, "no_trades");
  const offenders: string[] = [];
  let unknown = false;
  let worst = 0;
  for (const t of [...opened].sort(byOpened)) {
    const before = closedToday
      .filter((c) => c.id !== t.id && c.accountId === t.accountId && epoch(c.closedAt) < epoch(t.openedAt))
      .sort((a, b) => epoch(a.closedAt) - epoch(b.closedAt));
    let run = 0;
    let runUnknown = false;
    for (let i = before.length - 1; i >= 0; i--) {
      const loss = before[i].isLoss;
      if (loss == null) {
        runUnknown = true;
        break;
      }
      if (!loss) break;
      run++;
    }
    worst = Math.max(worst, run);
    if (run >= STOP_AFTER_LOSSES) offenders.push(t.id);
    else if (runUnknown) unknown = true;
  }
  if (offenders.length === 0 && unknown) return na(key, "unpriced");
  const breached = offenders.length > 0;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders,
    observed: null,
    limit: null,
    counted: { observed: worst, limit: STOP_AFTER_LOSSES },
  };
}

/**
 * Every Topstep position opened on the day is flat by that Topstep day's close:
 * the brief's time (a holiday or an early close), else 15:10 CT.
 *
 * A position still open is late only once the close has passed; before that it
 * is `not_yet`, not a pass — nothing about it has been decided.
 */
function evalFlatByClose(day: string, opened: TrackerTrade[], ctx: Required<AutoContext>): AutoRuleResult {
  const key: AutoRuleKey = "flat_by_close";
  if (opened.length === 0) return na(key, "no_trades");
  const topstep = opened.filter((t) => t.topstep);
  if (topstep.length === 0) return na(key, "no_topstep_trades");
  const flat = flatByFor(day, ctx.briefOf(day));
  if (flat.at == null) return na(key, "market_closed");
  const close = epoch(flat.at);
  const offenders: string[] = [];
  let pending = 0;
  for (const t of topstep) {
    const out = t.closedAt != null ? epoch(t.closedAt) : null;
    if (out != null ? out > close : ctx.now > close) offenders.push(t.id);
    else if (out == null) pending++;
  }
  if (offenders.length === 0 && pending === topstep.length) return { ...na(key, "not_yet"), at: flat.at };
  const breached = offenders.length > 0;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders,
    observed: null,
    limit: null,
    at: flat.at,
  };
}

/** No entry inside a red window of the day's brief — the brief's own windows only (G7). */
function evalNoEntryInRedWindow(day: string, opened: TrackerTrade[], ctx: Required<AutoContext>): AutoRuleResult {
  const key: AutoRuleKey = "no_entry_in_red_window";
  if (opened.length === 0) return na(key, "no_trades");
  const brief = ctx.briefOf(day);
  if (!brief) return na(key, "no_brief");
  const hits = [...opened]
    .sort(byOpened)
    .map((t) => ({ t, w: redWindowAt(t.openedAt, brief.redWindows) }))
    .filter((h) => h.w != null);
  const breached = hits.length > 0;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: hits.map((h) => h.t.id),
    observed: null,
    limit: null,
    ...(breached ? { window: hits[0].w?.title } : {}),
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
  /** The brief and the present moment, for the day-trading rules. */
  context: AutoContext = {},
): Record<AutoRuleKey, AutoRuleResult> {
  const closed = index.byCloseDay.get(day) ?? [];
  const opened = index.byOpenDay.get(day) ?? [];
  const ctx: Required<AutoContext> = {
    briefOf: context.briefOf ?? (() => null),
    now: context.now ?? Date.now(),
    tradingWindowOf: context.tradingWindowOf ?? (() => null),
    biasOf: context.biasOf ?? (() => null),
  };

  const results = {
    max_loss_per_day: evalMaxLossPerDay(closed),
    max_loss_per_trade: evalMaxLossPerTrade(closed),
    // Open day, not close day. Decisive counter-case: on close-day attribution a
    // still-open trade is INVISIBLE to the rule, so ten unlinked open trades
    // would report a perfect day.
    playbook_linked: evalPlaybookLinked(opened),
    // Open day for the sharper reason: the point is that the stop existed WHEN
    // YOU ENTERED. Grading it on the close day grades it after the risk is gone.
    stop_loss_set: evalOpenDayFlag("stop_loss_set", opened, (t) => t.hasStop),
    // Open day, and for this rule it is not a nuance but the entire content of
    // it. A thesis written after the fact is a rationalisation — the check is
    // that the reason existed BEFORE the position did, and only the open day
    // can say that. Only trades planned before their entry are graded — see
    // `evalThesisWritten`.
    thesis_written: evalThesisWritten(opened),
    // Open day, like the flags and for the same reason: the size is the decision
    // taken at entry. Grading it on the close day would grade it once the risk
    // has already been spent.
    risk_per_trade: evalRiskPerTrade(opened),
    risk_matched_intent: evalRiskMatchedIntent(opened),
    // Open day: each is a decision taken at entry — an entry in a red window,
    // an entry after the target was banked. The target reads the day's CLOSED
    // trades, since money only exists once it has closed.
    flat_by_close: evalFlatByClose(day, opened, ctx),
    no_entry_in_red_window: evalNoEntryInRedWindow(day, opened, ctx),
    no_entry_after_daily_target: evalNoEntryAfterDailyTarget(opened, closed),
    // Open day: the decision is the entry taken after the run.
    stop_after_two_losses: evalStopAfterTwoLosses(opened, closed),
    // Open day: the window of the day the position was opened on.
    trading_window: evalTradingWindow(day, opened, ctx),
    // Phase Q: what the trade page says, per trade opened that day.
    htf_bias_set: evalHtfBiasSet(day, opened, ctx),
    thesis_recorded: evalThesisRecorded(opened),
    review_complete: evalReviewComplete(day, opened, ctx),
    screenshot_per_trade: evalScreenshotPerTrade(opened),
  };
  // Last: it reads the verdicts above, per trade.
  return { ...results, honest_tags: evalHonestTags(opened, results) };
}
