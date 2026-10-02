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
 *   - A payout leaves the balance (30.09.2026): $6 000 with a $2 000 payout is
 *     $4 000, and with the MLL at the starting balance the room is what stayed.
 *     Payouts are the account's cash events of type payout or withdrawal
 *     (Settings › Accounts); the first one is also the payout date.
 *   - DLL: the trading day's net P&L. Reaching it ends the DAY, not the account.
 *   - A trading day runs 17:00 → 17:00 Chicago time, so a fill at 18:30 CT on a
 *     Monday belongs to Tuesday. The calendar day in the account's own zone is
 *     the wrong key, and on a Belgrade account it splits the US session in two.
 *   - Consistency: the best day must stay at or below 55 % of the profit target;
 *     past that the target grows to best day ÷ 0.55.
 *   - TopstepX Risk Limits (30.09.2026): the trader's own Personal Daily Loss
 *     Limit and Personal Daily Profit Target. Either one ends the trading day.
 *     The personal DLL is the day's DLL wherever it is tighter than the plan's
 *     (`topstepPlanRulesFor`); a looser one changes nothing, since Topstep
 *     still stops the day at the plan's.
 *
 * The Express Funded Account (phase T, 30.09.2026; account `topstep_stage`):
 *
 *   - It starts at $0 with the plan's MLL under it; the floor trails the
 *     end-of-day balance and locks at $0, and after the first payout it is $0.
 *   - No profit target and no 55 % rule. The Scaling Plan sets the most mini
 *     contracts (a micro is a tenth) from the balance at the start of the
 *     session — the last close — so a win raises the NEXT session's size:
 *
 *       balance       50K  100K  150K
 *       < 1 500        2     3     3
 *       1 500–1 999    3     4     4
 *       2 000–2 999    5     5     5
 *       3 000–4 499    5    10    10
 *       ≥ 4 500        5    10    15
 *
 *   - A payout has two paths, counted from the last payout: Standard — five
 *     winning days of $150 or more; Consistency — three traded days with the
 *     best at most 40 % of the net profit. A request is at most half the
 *     balance, capped at 2 000 / 3 000 (50K), 3 000 / 4 000 (100K), 5 000 /
 *     6 000 (150K) for Standard / Consistency, and at least $125.
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
import type { CashEvent } from "./balance";
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

/**
 * Trading Combine, Express Funded Account or Practice (`tj_accounts.topstep_stage`). Practice
 * (trader, 01.10.2026) keeps a Combine's rules to practise under them, passes nothing, and is kept
 * apart from the real accounts — the brief and the reminder leave it out.
 */
export type TopstepStage = "combine" | "xfa" | "practice";

/** XFA Scaling Plan: [balance from, most mini contracts], lowest tier first. */
export const TOPSTEP_XFA_SCALING: Record<TopstepPlan, readonly (readonly [number, number])[]> = {
  "50K": [[-Infinity, 2], [1_500, 3], [2_000, 5]],
  "100K": [[-Infinity, 3], [1_500, 4], [2_000, 5], [3_000, 10]],
  "150K": [[-Infinity, 3], [1_500, 4], [2_000, 5], [3_000, 10], [4_500, 15]],
};

/** The most mini contracts the XFA Scaling Plan allows at this XFA balance. */
export function topstepScalingMaxMini(plan: TopstepPlan, xfaBalance: number): number {
  let max = TOPSTEP_XFA_SCALING[plan][0][1];
  for (const [from, mini] of TOPSTEP_XFA_SCALING[plan]) if (xfaBalance >= from) max = mini;
  return max;
}

/** XFA payout rules (Topstep, checked 30.09.2026). */
export const TOPSTEP_XFA_PAYOUT = {
  winningDay: 150,
  winningDays: 5,
  consistencyShare: 0.4,
  consistencyDays: 3,
  balanceShare: 0.5,
  minimum: 125,
  caps: {
    "50K": { standard: 2_000, consistency: 3_000 },
    "100K": { standard: 3_000, consistency: 4_000 },
    "150K": { standard: 5_000, consistency: 6_000 },
  } satisfies Record<TopstepPlan, { standard: number; consistency: number }>,
} as const;

/** Where an XFA stands on both payout paths, counted from the last payout (or the start). */
export type TopstepXfaPayout = {
  winningDays: number;
  daysTraded: number;
  bestDayNet: number | null;
  netProfit: number;
  standard: { eligible: boolean; maxPayout: number };
  consistency: { eligible: boolean; bestShare: number | null; maxPayout: number };
};

export type TopstepConfig = {
  enabled: boolean;
  plan: TopstepPlan;
  /** Combine unless set: the Scaling Plan and the payout paths apply to an XFA only. */
  stage?: TopstepStage;
  startingBalance: number;
  /** First payout typed as a date only; the first payout event counts too, whichever is earlier. */
  payoutAt: string | null;
  resetAt: string | null;
  /** Money taken out of the account, in order: each lowers the balance, the first locks the MLL. */
  payouts?: readonly TopstepPayout[];
  /** TopstepX Personal Daily Loss Limit, positive; null = the plan's DLL. */
  personalDll: number | null;
  /** TopstepX Personal Daily Profit Target, positive; null = none. */
  dailyTarget: number | null;
};

export type TopstepTrade = { closedAt: string | null; net: number };

/** A payout: when, and how much left the account (positive). */
export type TopstepPayout = { at: string; amount: number };

export type TopstepStatus = "off" | "active" | "passed" | "failed";

export type TopstepResult = {
  status: TopstepStatus;
  stage: TopstepStage;
  /** The most mini contracts for the NEXT session: on an XFA the Scaling Plan tier of the balance now. */
  nextMaxMini: number;
  /** Payout paths on an XFA; null on a Combine. */
  xfa: TopstepXfaPayout | null;
  /** The plan's rules, with the day's DLL the personal one where that is tighter. */
  rules: TopstepPlanRules;
  /** Whether `rules.dll` is the trader's personal limit rather than the plan's. */
  personalDll: boolean;
  /** The personal daily profit target, and what is still missing to it today; null when none is set. */
  dailyTarget: number | null;
  targetLeftToday: number | null;
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
  /** Trading profit: the balance plus everything paid out, minus the start. */
  profit: number;
  /** Paid out so far, positive; 0 before the first payout. */
  paidOut: number;
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

/**
 * The plan's rules as they apply to this account: the plan's own, with the
 * DLL replaced by the trader's personal one where that is tighter.
 */
export function topstepPlanRulesFor(config: Pick<TopstepConfig, "plan" | "personalDll">): TopstepPlanRules {
  const plan = TOPSTEP_PLANS[config.plan];
  const personal = config.personalDll;
  return personal != null && personal > 0 && personal < plan.dll ? { ...plan, dll: personal } : plan;
}

/**
 * What the trade form sizes from, per Topstep account: the room, today's DLL
 * left, the plan — and the personal daily target, which the day page shows.
 */
export type TopstepSizing = {
  room: number;
  dllLeftToday: number;
  plan: TopstepPlanRules;
  target?: { of: number; left: number } | null;
};

const positiveOrNull = (v: number | null | undefined) => (v != null && v > 0 ? Number(v) : null);

/**
 * The account's payouts from its cash events: payouts and withdrawals, as the
 * positive amount that left. Deposits and adjustments do not exist on a Topstep
 * account and are not read.
 */
export function topstepPayoutsOf(accountId: string, cash: readonly CashEvent[]): TopstepPayout[] {
  return cash
    .filter(
      (c) =>
        c.account_id === accountId &&
        (c.event_type === "payout" || c.event_type === "withdrawal") &&
        Number(c.amount) !== 0,
    )
    .map((c) => ({ at: c.occurred_at, amount: Math.abs(Number(c.amount)) }))
    .sort((a, b) => compareInstants(a.at, b.at));
}

export function topstepConfigFromAccount(account: Account, cash: readonly CashEvent[] = []): TopstepConfig {
  return {
    enabled: account.topstep_mode === true,
    plan: account.topstep_plan ?? "50K",
    startingBalance: account.starting_balance,
    payoutAt: account.topstep_payout_at ?? null,
    resetAt: account.topstep_reset_at ?? null,
    payouts: topstepPayoutsOf(account.id, cash),
    personalDll: positiveOrNull(account.topstep_personal_dll),
    dailyTarget: positiveOrNull(account.topstep_daily_target),
    stage: account.topstep_stage === "xfa" || account.topstep_stage === "practice" ? account.topstep_stage : "combine",
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
  const rules = topstepPlanRulesFor(config);
  const start = config.startingBalance;
  const resetMs = config.resetAt == null ? null : toEpoch(config.resetAt);
  const nowMs = toEpoch(now);
  const inWindow = (at: string | null) => at != null && (resetMs == null || toEpoch(at) >= resetMs);

  const today = topstepTradingDay(now);
  const window = trades.filter((t) => inWindow(t.closedAt));
  // A reset starts a new account, and a payout after `now` has not happened yet.
  const payouts = (config.payouts ?? []).filter((p) => inWindow(p.at) && toEpoch(p.at) <= nowMs);
  // The first payout, typed as a date or recorded as money, whichever came first.
  const firstPayoutMs = Math.min(
    config.payoutAt == null ? Infinity : toEpoch(config.payoutAt),
    payouts.length > 0 ? toEpoch(payouts[0].at) : Infinity,
  );
  const payoutMs = Number.isFinite(firstPayoutMs) ? firstPayoutMs : null;

  // Trading days in order, each with its trades and payouts in time order.
  type Step = { at: string; net: number; out: number };
  const days = new Map<string, Step[]>();
  const traded = new Set<string>();
  const push = (at: string, step: Step) => {
    const key = topstepTradingDay(at);
    days.set(key, [...(days.get(key) ?? []), step]);
  };
  for (const t of window) {
    push(t.closedAt!, { at: t.closedAt!, net: t.net, out: 0 });
    traded.add(topstepTradingDay(t.closedAt!));
  }
  for (const p of payouts) push(p.at, { at: p.at, net: 0, out: p.amount });

  let balance = start;
  // The balance at the last close before today: the XFA Scaling Plan sizes the session from it.
  let eodBalance = start;
  let paidOut = 0;
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

  for (const [day, steps] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let net = 0;
    for (const step of [...steps].sort((a, b) => compareInstants(a.at, b.at))) {
      // After the first payout the floor is the starting balance, from that moment.
      if (payoutMs != null && toEpoch(step.at) >= payoutMs) {
        floor = start;
        locked = true;
      }
      net += step.net;
      balance += step.net - step.out;
      paidOut += step.out;
      // Realized balance on or under the floor: the account is over. Intraday
      // with open P&L it may have ended earlier — see the header. A payout
      // that leaves nothing above the floor is room gone, not a lost account.
      if (step.out === 0 && breachDay == null && balance <= floor) breachDay = day;
      seeRoom();
    }
    if (traded.has(day)) {
      if (net <= -rules.dll) dllDays.push(day);
      if (bestDay == null || net > bestDay.net) bestDay = { day, net };
    }

    // End of the trading day: the floor follows the highest close, never down,
    // and stops at the starting balance. Today has not ended — a win this
    // morning must not raise the floor the trader sizes the afternoon from.
    if (day >= today) continue;
    eodBalance = balance;
    highEod = Math.max(highEod, balance);
    if (!locked) {
      floor = Math.max(floor, Math.min(start, highEod - rules.mll));
      locked = floor >= start;
    }
    // The trail happens overnight, under an unchanged balance: that is a
    // moment the room shrinks too.
    seeRoom();
  }
  if (payoutMs != null && nowMs >= payoutMs) {
    floor = start;
    locked = true;
  }

  const todayNet = (days.get(today) ?? []).reduce((s, t) => s + t.net, 0);
  const effectiveTarget = Math.max(
    rules.target,
    bestDay && bestDay.net > 0 ? bestDay.net / TOPSTEP_CONSISTENCY : 0,
  );
  const profit = balance + paidOut - start;

  const stage: TopstepStage = config.stage ?? "combine";
  const isXfa = stage === "xfa";

  let status: TopstepStatus = "active";
  if (breachDay != null) status = "failed";
  else if (stage === "combine" && profit >= effectiveTarget) status = "passed";

  return {
    status,
    stage,
    nextMaxMini: isXfa ? topstepScalingMaxMini(config.plan, balance - start) : rules.maxMini,
    xfa: isXfa ? xfaPayout(config.plan, window, payouts, balance - start) : null,
    rules: isXfa ? { ...rules, maxMini: topstepScalingMaxMini(config.plan, eodBalance - start) } : rules,
    personalDll: rules.dll !== TOPSTEP_PLANS[config.plan].dll,
    dailyTarget: config.dailyTarget,
    targetLeftToday: config.dailyTarget == null ? null : Math.max(0, config.dailyTarget - todayNet),
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
    paidOut,
    daysTraded: traded.size,
    headroomPct:
      minRoom == null ? null : Math.max(0, Math.min(100, (minRoom / rules.mll) * 100)),
  };
}

/**
 * Both XFA payout paths, counted from the last payout: each trading day's net
 * of the trades closed after it. `xfaBalance` is what a request is half of.
 */
function xfaPayout(
  plan: TopstepPlan,
  trades: readonly TopstepTrade[],
  payouts: readonly TopstepPayout[],
  xfaBalance: number,
): TopstepXfaPayout {
  const P = TOPSTEP_XFA_PAYOUT;
  const since = payouts.length > 0 ? Math.max(...payouts.map((p) => toEpoch(p.at))) : -Infinity;
  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (t.closedAt == null || toEpoch(t.closedAt) <= since) continue;
    const day = topstepTradingDay(t.closedAt);
    byDay.set(day, (byDay.get(day) ?? 0) + t.net);
  }
  const nets = [...byDay.values()];
  const netProfit = nets.reduce((a, b) => a + b, 0);
  const bestDayNet = nets.length > 0 ? Math.max(...nets) : null;
  const bestShare = bestDayNet != null && netProfit > 0 ? Math.max(0, bestDayNet) / netProfit : null;
  const half = Math.max(0, xfaBalance) * P.balanceShare;
  const cap = (limit: number) => {
    const amount = Math.min(half, limit);
    return amount >= P.minimum ? amount : 0;
  };
  const winningDays = nets.filter((n) => n >= P.winningDay).length;
  return {
    winningDays,
    daysTraded: nets.length,
    bestDayNet,
    netProfit,
    standard: { eligible: winningDays >= P.winningDays, maxPayout: cap(P.caps[plan].standard) },
    consistency: {
      eligible: nets.length >= P.consistencyDays && bestShare != null && bestShare <= P.consistencyShare + 1e-12,
      bestShare,
      maxPayout: cap(P.caps[plan].consistency),
    },
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

/**
 * The room from which the risk rule's money floor holds (R3, 30.09.2026): a
 * third of the plan's MLL — $1 500 on a 150K. Under it the budget is the plain
 * share of the room. The plan's MLL, not the personal DLL: the floor is about
 * what is left of the account, not of the day.
 */
export function topstepMinRiskFromRoom(plan: TopstepPlanRules): number {
  return plan.mll / 3;
}

/** The share of the room the risk rule takes when the account sets none — the trader's rule. */
export const TOPSTEP_DEFAULT_RISK_PCT = 8;

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

/** The breakeven half-width in dollars for a plan: ±$16 on a 50K, ±$24 on a 100K, ±$36 on a 150K. */
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
    minFromRoom: topstepMinRiskFromRoom(s.rules),
  });
  return risk?.amount ?? 0;
}

/** What the tracker needs to grade a Topstep account's trades: its rules and its risk rule. */
export type TopstepRules = { config: TopstepConfig; risk: TopstepRiskRule };

/** Per account id: its Topstep rules, or null for any account not in Topstep mode. */
export function topstepRulesResolver(
  accounts: readonly Account[],
  /** The accounts' cash events: a payout lowers the balance every budget is derived from. */
  cash: readonly CashEvent[] = [],
): (accountId: string | null | undefined) => TopstepRules | null {
  const byId = new Map<string, TopstepRules>();
  for (const a of accounts) {
    if (a.topstep_mode) byId.set(a.id, { config: topstepConfigFromAccount(a, cash), risk: riskRuleFromAccount(a) });
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
