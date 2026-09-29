/**
 * Topstep account rules — pure, from realized (closed) trades.
 *
 * Topstep's limits are fixed money per plan, not percentages, and the one that
 * ends an account — the Maximum Loss Limit — TRAILS the highest END-OF-DAY
 * balance and never comes down. A percentage floor fixed at the start cannot
 * describe it.
 *
 * Rules, read off help.topstep.com on 28.09.2026:
 *
 *   plan   MLL     DLL     max position        profit target
 *   50K    2 000   1 000    5 mini /  50 micro  3 000
 *   100K   3 000   2 000   10 mini / 100 micro  6 000
 *   150K   4 500   3 000   15 mini / 150 micro  9 000
 *
 *   - MLL: starting balance − MLL at first; afterwards the highest END-OF-DAY
 *     balance − MLL, never lower. It locks at the starting balance (the Combine
 *     at its opening value, the Express Funded Account at its $0, which is the
 *     same place measured from its own start). After the first payout it IS the
 *     starting balance, whatever it was before.
 *   - DLL: the trading day's net P&L. Reaching it ends the DAY, not the account.
 *   - A trading day runs 17:00 → 17:00 Chicago time, so a fill at 18:30 CT on a
 *     Monday belongs to Tuesday. The calendar day in the account's own zone is
 *     the wrong key, and on a Belgrade account it splits the US session in two.
 *   - Consistency: the best day must stay at or below 55 % of the profit target;
 *     past that the target grows to best day ÷ 0.55.
 *
 * Approximation: Topstep watches the MLL and DLL INTRADAY with
 * unrealized P&L. A journal only knows closed trades, so a position that went
 * through the floor and came back shows here as a survived day. Good enough to
 * plan with and to review discipline; the platform's own risk engine is the
 * record.
 */
import { MINI_OF } from "./default-instruments";
import { computeTopstepRisk } from "./plan-calculations";
import { compareInstants, toEpoch, topstepTradingDay } from "./time";
import type { Account } from "./types";

export type TopstepPlan = "50K" | "100K" | "150K";

export type TopstepPlanRules = {
  mll: number;
  dll: number;
  target: number;
  maxMini: number;
  /** The trader's risk-per-trade bounds for this plan: three stops fit in the DLL. */
  riskMin: number;
  riskMax: number;
};

export const TOPSTEP_PLANS: Record<TopstepPlan, TopstepPlanRules> = {
  "50K": { mll: 2000, dll: 1000, target: 3000, maxMini: 5, riskMin: 60, riskMax: 300 },
  "100K": { mll: 3000, dll: 2000, target: 6000, maxMini: 10, riskMin: 120, riskMax: 600 },
  "150K": { mll: 4500, dll: 3000, target: 9000, maxMini: 15, riskMin: 180, riskMax: 900 },
};

/** Best day at or below this share of the profit target. */
export const TOPSTEP_CONSISTENCY = 0.55;

export type TopstepConfig = {
  enabled: boolean;
  plan: TopstepPlan;
  startingBalance: number;
  payoutAt: string | null;
  resetAt: string | null;
};

export type TopstepTrade = { closedAt: string | null; net: number };

export type TopstepStatus = "off" | "active" | "passed" | "failed";

export type TopstepResult = {
  status: TopstepStatus;
  rules: TopstepPlanRules;
  balance: number;
  /** The balance the account may not touch, as it stands now. */
  mllFloor: number;
  /** Balance − floor: what can still be lost in total. The real size of the account. */
  room: number;
  /** Whether the floor has reached the starting balance and stopped. */
  mllLocked: boolean;
  /** The trading day the floor was first touched, or null. */
  mllBreachDay: string | null;
  /** Trading days whose net loss reached the DLL (a stopped day, not a failed account). */
  dllDays: string[];
  /** Net P&L of the current trading day, and what the DLL still allows today. */
  todayNet: number;
  dllLeftToday: number;
  bestDay: { day: string; net: number } | null;
  /** The target as it stands after the consistency rule (grows past a big day). */
  effectiveTarget: number;
  consistencyOk: boolean;
  profit: number;
  daysTraded: number;
  /**
   * The closest the account ever came to its floor: the smallest room seen,
   * after every close and every overnight trail, as a share of the plan's MLL
   * (0–100) — a trailing floor has no fixed percentage, so the measure is the
   * room itself. Null
   * with no trades: nothing was tested.
   */
  headroomPct: number | null;
};

/** What the trade form sizes from, per Topstep account: the room, today's DLL left, the plan. */
export type TopstepSizing = { room: number; dllLeftToday: number; plan: TopstepPlanRules };

export function topstepConfigFromAccount(account: Account): TopstepConfig {
  return {
    enabled: account.topstep_mode === true,
    plan: account.topstep_plan ?? "50K",
    startingBalance: account.starting_balance,
    payoutAt: account.topstep_payout_at ?? null,
    resetAt: account.topstep_reset_at ?? null,
  };
}

/** The Topstep trading day a moment belongs to — lives in `time.ts`, next to every other day key. */
export { topstepTradingDay };

export function evaluateTopstep(
  config: TopstepConfig,
  trades: TopstepTrade[],
  now: string | Date = new Date(),
): TopstepResult | { status: "off" } {
  if (!config.enabled) return { status: "off" };
  const rules = TOPSTEP_PLANS[config.plan];
  const start = config.startingBalance;
  const resetMs = config.resetAt == null ? null : toEpoch(config.resetAt);
  const payoutMs = config.payoutAt == null ? null : toEpoch(config.payoutAt);

  const today = topstepTradingDay(now);
  const window = trades
    .filter((t) => t.closedAt != null && (resetMs == null || toEpoch(t.closedAt) >= resetMs))
    .sort((a, b) => compareInstants(a.closedAt, b.closedAt));

  // Trading days in order, each with its trades in order.
  const days = new Map<string, TopstepTrade[]>();
  for (const t of window) {
    const key = topstepTradingDay(t.closedAt!);
    days.set(key, [...(days.get(key) ?? []), t]);
  }

  let balance = start;
  let highEod = start;
  let floor = start - rules.mll;
  let locked = false;
  let breachDay: string | null = null;
  const dllDays: string[] = [];
  let bestDay: { day: string; net: number } | null = null;
  let minRoom: number | null = null;
  const seeRoom = () => {
    const room = balance - floor;
    if (minRoom == null || room < minRoom) minRoom = room;
  };

  for (const [day, dayTrades] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let net = 0;
    for (const t of dayTrades) {
      // After the first payout the floor is the starting balance, from that moment.
      if (payoutMs != null && toEpoch(t.closedAt!) >= payoutMs) {
        floor = start;
        locked = true;
      }
      net += t.net;
      balance += t.net;
      // Realized balance on or under the floor: the account is over. Intraday
      // with open P&L it may have ended earlier — see the header.
      if (breachDay == null && balance <= floor) breachDay = day;
      seeRoom();
    }
    if (net <= -rules.dll) dllDays.push(day);
    if (bestDay == null || net > bestDay.net) bestDay = { day, net };

    // End of the trading day: the floor follows the highest close, never down,
    // and stops at the starting balance. Today has not ended — a win this
    // morning must not raise the floor the trader sizes the afternoon from.
    if (day >= today) continue;
    highEod = Math.max(highEod, balance);
    if (!locked) {
      floor = Math.max(floor, Math.min(start, highEod - rules.mll));
      locked = floor >= start;
    }
    // The trail happens overnight, under an unchanged balance: that is a
    // moment the room shrinks too.
    seeRoom();
  }
  if (payoutMs != null && toEpoch(now) >= payoutMs) {
    floor = start;
    locked = true;
  }

  const todayNet = (days.get(today) ?? []).reduce((s, t) => s + t.net, 0);
  const effectiveTarget = Math.max(
    rules.target,
    bestDay && bestDay.net > 0 ? bestDay.net / TOPSTEP_CONSISTENCY : 0,
  );
  const profit = balance - start;

  let status: TopstepStatus = "active";
  if (breachDay != null) status = "failed";
  else if (profit >= effectiveTarget) status = "passed";

  return {
    status,
    rules,
    balance,
    mllFloor: floor,
    room: balance - floor,
    mllLocked: locked,
    mllBreachDay: breachDay,
    dllDays,
    todayNet,
    dllLeftToday: Math.max(0, rules.dll + todayNet),
    bestDay,
    effectiveTarget,
    consistencyOk: bestDay == null || bestDay.net <= rules.target * TOPSTEP_CONSISTENCY,
    profit,
    daysTraded: days.size,
    headroomPct:
      minRoom == null ? null : Math.max(0, Math.min(100, (minRoom / rules.mll) * 100)),
  };
}

/**
 * The account as it stood at `instant`: only trades CLOSED before it count, and
 * the day `instant` falls in has not ended, so its wins have not raised the
 * floor yet. Exactly `evaluateTopstep` asked at that moment — one walk, so the
 * state a past trade is graded against cannot drift from the banner's.
 */
export function topstepStateAt(
  config: TopstepConfig,
  trades: readonly TopstepTrade[],
  instant: string | Date,
): TopstepResult | null {
  const at = toEpoch(instant);
  if (!Number.isFinite(at)) return null;
  const before = trades.filter((t) => t.closedAt != null && toEpoch(t.closedAt) < at);
  const r = evaluateTopstep(config, before, instant);
  return r.status === "off" ? null : (r as TopstepResult);
}

/** The share of the room the risk rule takes when the account sets none — the trader's rule. */
export const TOPSTEP_DEFAULT_RISK_PCT = 12.5;

/**
 * The breakeven band, as a share of R (K4, 29.09.2026: fixed, not a setting).
 *
 * A trade whose net result is within a tenth of the risk it was sized to is a
 * scratch — neither the setup's win nor its loss. The R is the plan's starting
 * risk budget, `TOPSTEP_DEFAULT_RISK_PCT` of the room a fresh account has above
 * its MLL, so the band is one fixed amount per plan and the win rate does not
 * move with a setting.
 */
export const TOPSTEP_BREAKEVEN_R = 0.1;

/** The breakeven half-width in dollars for a plan: ±$25 on a 50K, ±$38 on a 100K, ±$56 on a 150K. */
export function topstepBreakevenBand(plan: TopstepPlan): number {
  return Math.round(TOPSTEP_BREAKEVEN_R * (TOPSTEP_DEFAULT_RISK_PCT / 100) * TOPSTEP_PLANS[plan].mll);
}

/** The trader's risk rule on an account: a share of the room, and optional money bounds. */
export type TopstepRiskRule = { pct: number; min: number | null; max: number | null };

export function riskRuleFromAccount(account: Account): TopstepRiskRule {
  return {
    pct: account.risk_rule_pct ?? TOPSTEP_DEFAULT_RISK_PCT,
    min: account.risk_rule_min ?? null,
    max: account.risk_rule_max ?? null,
  };
}

/**
 * What the risk rule allowed at `instant` — the budget a trade entered then
 * should have been sized from (`computeTopstepRisk`, the same call the trade
 * form makes). 0 on an account with no room or no DLL left: nothing was
 * allowed, which is an answer, not an unknown. Null outside Topstep mode.
 */
export function riskBudgetAt(
  config: TopstepConfig,
  rule: TopstepRiskRule,
  trades: readonly TopstepTrade[],
  instant: string | Date,
): number | null {
  const s = topstepStateAt(config, trades, instant);
  if (!s) return null;
  const risk = computeTopstepRisk({
    room: s.room,
    pct: rule.pct,
    min: rule.min ?? s.rules.riskMin,
    max: rule.max ?? s.rules.riskMax,
    dllLeft: s.dllLeftToday,
  });
  return risk?.amount ?? 0;
}

/** What the tracker needs to grade a Topstep account's trades: its rules and its risk rule. */
export type TopstepRules = { config: TopstepConfig; risk: TopstepRiskRule };

/** Per account id: its Topstep rules, or null for any account not in Topstep mode. */
export function topstepRulesResolver(
  accounts: readonly Account[],
): (accountId: string | null | undefined) => TopstepRules | null {
  const byId = new Map<string, TopstepRules>();
  for (const a of accounts) {
    if (a.topstep_mode) byId.set(a.id, { config: topstepConfigFromAccount(a), risk: riskRuleFromAccount(a) });
  }
  return (accountId) => (accountId ? (byId.get(accountId) ?? null) : null);
}

/**
 * The most contracts the plan lets the account hold, in THIS contract's units:
 * Topstep counts a micro as a tenth of a mini, so its cap is ten times as many.
 */
export function topstepMaxContracts(plan: TopstepPlanRules, symbol: string | null | undefined): number {
  return plan.maxMini * (symbol && MINI_OF[symbol] ? 10 : 1);
}

/**
 * How far past the risk budget a single trade's loss may go before the tracker
 * calls it a breach (decision E3, 28.09.2026): a stop filled a tick or two late
 * is the market, not the trader. 10 % of the budget.
 */
export const TOPSTEP_SLIPPAGE_TOLERANCE = 0.1;
