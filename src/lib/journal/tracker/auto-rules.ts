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

import { numberFieldValue } from "../field-values";
import { computeFuturesContracts } from "../plan-calculations";
import { plannedEntryOf, sealedNumber, sealedText } from "../plan-snapshot";
import {
  riskBudgetAt,
  TOPSTEP_PLANS,
  TOPSTEP_SLIPPAGE_TOLERANCE,
  topstepMaxContracts,
  type TopstepRules,
  type TopstepTrade,
} from "../topstep";
import { dayKeyIn, type DayZone } from "../time";
import { flatByFor, redWindowAt, type SessionBrief } from "../session-brief";
import { riskMoneyAtEntry } from "../risk-taken";
import type { AutoRuleKey } from "../tracker-types";
import type { TradeRow } from "../types";

export type { AutoRuleKey } from "../tracker-types";

export type AutoVerdict = "pass" | "fail" | "na";

export type AutoReason =
  | "ok"
  | "violated"
  /** No count configured — the rule cannot say anything yet. */
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
export type LimitBasis = "topstep_dll" | "topstep_budget" | "topstep_budget_slippage";

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
  /**
   * A count rule's numbers — entries on the busiest account, or the losing run
   * an entry followed — beside the configured count. Kept apart from
   * `observed`/`limit`, which the checklist reads as money.
   */
  counted?: { observed: number; limit: number };
  /** `flat_by_close`: the close the day was graded against, ISO UTC. */
  at?: string | null;
  /** `no_entry_in_red_window`: the window of the first offending entry. */
  window?: string;
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
  /** Account-timezone day it closed, null while still open. */
  closeDay: string | null;
  /** Null when `point_value_source` is 'missing' — price unknown, not zero. */
  netPl: number | null;
  hasPlaybook: boolean;
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
    /** The plan's Daily Loss Limit, positive. */
    dll: number;
    /**
     * What the risk rule allowed at entry: `risk_budget_at_entry` as sealed,
     * else derived from the account's closed trades at that moment. Null only
     * when the entry instant cannot be read.
     */
    budget: number | null;
  } | null;
};

export type TradeDayIndex = {
  /** Decision-time rules: playbook link, stop loss. */
  byOpenDay: Map<string, TrackerTrade[]>;
  /** Money rules: per-trade and per-day loss. */
  byCloseDay: Map<string, TrackerTrade[]>;
};

export type AutoConfigs = Partial<Record<AutoRuleKey, { count?: number }>>;

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
    maxContracts: topstepMaxContracts(
      TOPSTEP_PLANS[book.rules.config.plan],
      typeof row.instrument === "string" ? row.instrument : null,
    ),
  });
  return out?.contracts ?? null;
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
    closeDay: row.stats?.closed_at ? dayKeyIn(row.stats.closed_at, zone) : null,
    netPl: row.stats?.net_pl ?? null,
    hasPlaybook: row.playbook_id != null && row.playbook_id !== "",
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
    topstep: book ? { dll: TOPSTEP_PLANS[book.rules.config.plan].dll, budget } : null,
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

/** One Topstep account's day against its plan's DLL — inclusive, as Topstep counts it. */
function topstepDayLoss(trades: TrackerTrade[]): AutoRuleResult {
  const key: AutoRuleKey = "max_loss_per_day";
  if (trades.some((t) => t.netPl == null)) return na(key, "unpriced");
  const net = trades.reduce((s, t) => s + (t.netPl ?? 0), 0);
  const limit = -(trades[0].topstep as { dll: number }).dll;
  const breached = net <= limit;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders: breached ? trades.map((t) => t.id) : [],
    observed: net,
    limit,
    basis: "topstep_dll",
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

// --- The day trader's rules (F4: G5, G7, G9) -----------------------------------

const epoch = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));
const byOpened = (a: TrackerTrade, b: TrackerTrade) => epoch(a.openedAt) - epoch(b.openedAt);

/** Trades grouped by account, in first-seen order — the count rules are per account (G9). */
function byAccount(trades: TrackerTrade[]): TrackerTrade[][] {
  const groups = new Map<string, TrackerTrade[]>();
  for (const t of trades) groups.set(t.accountId ?? "", [...(groups.get(t.accountId ?? "") ?? []), t]);
  return [...groups.values()];
}

/**
 * At most N entries per account on the day they were OPENED.
 *
 * The offenders are the entries past the N-th, in the order they were taken —
 * the first two trades of a day were within the rule; the third was the breach.
 */
function evalMaxTradesPerDay(opened: TrackerTrade[], count: number | undefined): AutoRuleResult {
  const key: AutoRuleKey = "max_trades_per_day";
  if (count == null) return na(key, "unconfigured");
  if (opened.length === 0) return na(key, "no_trades");
  const offenders: string[] = [];
  let busiest = 0;
  for (const group of byAccount(opened)) {
    const sorted = [...group].sort(byOpened);
    busiest = Math.max(busiest, sorted.length);
    offenders.push(...sorted.slice(count).map((t) => t.id));
  }
  const breached = offenders.length > 0;
  return {
    key,
    verdict: breached ? "fail" : "pass",
    reason: breached ? "violated" : "ok",
    offenders,
    observed: null,
    limit: null,
    counted: { observed: busiest, limit: count },
  };
}

/**
 * No entry after N losses in a row on the same account, that day.
 *
 * A loss counts only once it has CLOSED before the entry — the decision to take
 * the next trade is made with the losses the trader already has. The run is
 * broken by any trade that was not a loss (a win or an exact scratch), and a
 * trade with no price leaves every entry after it unknown: the missing result
 * may be the loss that completed the run, or the win that broke it.
 */
function evalStopAfterLosses(
  opened: TrackerTrade[],
  closedToday: TrackerTrade[],
  count: number | undefined,
): AutoRuleResult {
  const key: AutoRuleKey = "stop_after_losses";
  if (count == null) return na(key, "unconfigured");
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
      const net = before[i].netPl;
      if (net == null) {
        runUnknown = true;
        break;
      }
      if (net >= 0) break;
      run++;
    }
    worst = Math.max(worst, run);
    if (run >= count) offenders.push(t.id);
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
    counted: { observed: worst, limit: count },
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
  configs: AutoConfigs,
  /** The brief and the present moment, for the day-trading rules. */
  context: AutoContext = {},
): Record<AutoRuleKey, AutoRuleResult> {
  const closed = index.byCloseDay.get(day) ?? [];
  const opened = index.byOpenDay.get(day) ?? [];
  const ctx: Required<AutoContext> = {
    briefOf: context.briefOf ?? (() => null),
    now: context.now ?? Date.now(),
  };

  return {
    max_loss_per_day: evalMaxLossPerDay(closed),
    max_loss_per_trade: evalMaxLossPerTrade(closed),
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
    // can say that. Only trades planned before their entry are graded — see
    // `evalThesisWritten`.
    thesis_written: evalThesisWritten(opened),
    // Open day, like the flags and for the same reason: the size is the decision
    // taken at entry. Grading it on the close day would grade it once the risk
    // has already been spent.
    risk_per_trade: evalRiskPerTrade(opened),
    risk_matched_intent: evalRiskMatchedIntent(opened),
    // Open day: each is a decision taken at entry — a third trade, a trade after
    // the run of losses, an entry in a red window. The losing run reads the
    // day's CLOSED trades, since a loss only exists once it has closed.
    max_trades_per_day: evalMaxTradesPerDay(opened, configs.max_trades_per_day?.count),
    stop_after_losses: evalStopAfterLosses(opened, closed, configs.stop_after_losses?.count),
    flat_by_close: evalFlatByClose(day, opened, ctx),
    no_entry_in_red_window: evalNoEntryInRedWindow(day, opened, ctx),
  };
}

/** Configs keyed by `auto_key`, for the evaluator. */
export function configsFromRules(
  rules: readonly { auto_key: AutoRuleKey | null; config: { count?: number } }[],
): AutoConfigs {
  const out: AutoConfigs = {};
  for (const r of rules) {
    if (r.auto_key) out[r.auto_key] = r.config ?? {};
  }
  return out;
}
