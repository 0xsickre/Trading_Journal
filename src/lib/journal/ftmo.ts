/**
 * FTMO / prop-firm challenge evaluation — pure, from realized (closed) trades.
 *
 * Approximation note: a real prop firm measures intraday *equity* including open
 * floating P/L. A trade journal only knows *realized* results, so daily loss and
 * drawdown are evaluated from realized net P/L per closed trade. Good enough to
 * train discipline on a demo account, not a substitute for the broker's own risk
 * engine.
 */
import type { Account } from "./types";
import { compareInstants, toEpoch, zonedDateKey } from "./time";

export type FtmoConfig = {
  enabled: boolean;
  startingBalance: number;
  timezone: string;
  dailyLoss: { enabled: boolean; pct: number };
  maxLoss: { enabled: boolean; pct: number };
  profitTarget: { enabled: boolean; pct: number };
  minDays: { enabled: boolean; days: number };
  /** Trades closed before this ISO instant are ignored (challenge "reset"). */
  resetAt: string | null;
};

export type FtmoTrade = { closedAt: string | null; net: number };

export type FtmoRule = "daily_loss" | "max_loss";

export type FtmoBreach = {
  rule: FtmoRule;
  /** Day (account tz) the breach occurred. */
  date: string;
  /** The offending amount (negative): day loss for daily, equity delta for max. */
  amount: number;
  /** The limit that was crossed (negative money). */
  limit: number;
};

export type FtmoStatus = "off" | "active" | "passed" | "failed";

export type FtmoResult = {
  status: FtmoStatus;
  /** Earliest breach per broken rule, oldest first. Empty unless failed. */
  breaches: FtmoBreach[];
  netPnl: number;
  profitPct: number;
  currentEquity: number;
  peakEquity: number;
  /** Worst realized equity drawdown from starting balance, in % (>= 0). */
  maxDrawdownPct: number;
  worstDay: { date: string; net: number } | null;
  daysTraded: number;
  targetReached: boolean;
  minDaysMet: boolean;
  // Display thresholds (money):
  dailyLossLimit: number | null;
  maxLossFloor: number | null;
  profitTargetAmount: number | null;
};

export function ftmoConfigFromAccount(account: Account): FtmoConfig {
  return {
    enabled: account.ftmo_mode,
    startingBalance: account.starting_balance,
    timezone: account.timezone,
    dailyLoss: {
      enabled: account.ftmo_daily_loss_enabled,
      pct: account.ftmo_daily_loss_pct,
    },
    maxLoss: {
      enabled: account.ftmo_max_loss_enabled,
      pct: account.ftmo_max_loss_pct,
    },
    profitTarget: {
      enabled: account.ftmo_profit_target_enabled,
      pct: account.ftmo_profit_target_pct,
    },
    minDays: {
      enabled: account.ftmo_min_days_enabled,
      days: account.ftmo_min_days,
    },
    resetAt: account.ftmo_reset_at,
  };
}

const OFF_RESULT: FtmoResult = {
  status: "off",
  breaches: [],
  netPnl: 0,
  profitPct: 0,
  currentEquity: 0,
  peakEquity: 0,
  maxDrawdownPct: 0,
  worstDay: null,
  daysTraded: 0,
  targetReached: false,
  minDaysMet: false,
  dailyLossLimit: null,
  maxLossFloor: null,
  profitTargetAmount: null,
};

export function evaluateFtmo(
  config: FtmoConfig,
  trades: FtmoTrade[],
): FtmoResult {
  if (!config.enabled) return OFF_RESULT;

  const start = config.startingBalance;
  const dailyLossLimit =
    config.dailyLoss.enabled && start > 0
      ? -(start * config.dailyLoss.pct) / 100
      : null;
  const maxLossFloor =
    config.maxLoss.enabled && start > 0
      ? start - (start * config.maxLoss.pct) / 100
      : null;
  const profitTargetAmount =
    config.profitTarget.enabled && start > 0
      ? (start * config.profitTarget.pct) / 100
      : null;

  // Window: closed trades on/after resetAt, chronological. Compared as instants,
  // not as text: resetAt is written by the app as "...T10:00:00.000Z" while
  // closedAt comes back from PostgREST as "...T10:00:00+00:00", and a string
  // compare of those inverts at an identical whole second — which is exactly
  // when a reset and a close can coincide.
  const resetMs = config.resetAt == null ? null : toEpoch(config.resetAt);
  const window = trades
    .filter(
      (t) =>
        t.closedAt != null && (resetMs == null || toEpoch(t.closedAt) >= resetMs),
    )
    .sort((a, b) => compareInstants(a.closedAt, b.closedAt));

  const dayNet = new Map<string, number>();
  let cum = 0;
  // Deliberately excludes tj_cash_events, unlike the dashboard's equity curve.
  // A prop-firm drawdown floor is fixed to the balance the challenge started
  // with — letting a deposit raise the floor would hand back room the rules
  // never granted. Deposits and payouts belong to account performance, not to
  // challenge evaluation.
  let equity = start;
  let peakEquity = start;
  let minEquity = start;
  let maxBreach: FtmoBreach | null = null;

  for (const t of window) {
    const day = zonedDateKey(t.closedAt, config.timezone);
    dayNet.set(day, (dayNet.get(day) ?? 0) + t.net);

    cum += t.net;
    equity = start + cum;
    peakEquity = Math.max(peakEquity, equity);
    minEquity = Math.min(minEquity, equity);

    // Static max loss: first time realized equity crosses the floor.
    if (maxLossFloor != null && maxBreach == null && equity <= maxLossFloor) {
      maxBreach = {
        rule: "max_loss",
        date: day,
        amount: equity - start,
        limit: maxLossFloor - start,
      };
    }
  }

  // Daily loss: earliest day whose realized loss crosses the limit.
  let dailyBreach: FtmoBreach | null = null;
  if (dailyLossLimit != null) {
    for (const [date, net] of [...dayNet.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      if (net <= dailyLossLimit) {
        dailyBreach = {
          rule: "daily_loss",
          date,
          amount: net,
          limit: dailyLossLimit,
        };
        break;
      }
    }
  }

  const breaches = [dailyBreach, maxBreach].filter(
    (b): b is FtmoBreach => b != null,
  );
  breaches.sort((a, b) => a.date.localeCompare(b.date));

  let worstDay: { date: string; net: number } | null = null;
  for (const [date, net] of dayNet) {
    if (worstDay == null || net < worstDay.net) worstDay = { date, net };
  }

  const daysTraded = dayNet.size;
  const targetReached =
    profitTargetAmount != null && peakEquity - start >= profitTargetAmount;
  const minDaysMet =
    !config.minDays.enabled || daysTraded >= config.minDays.days;

  let status: FtmoStatus;
  if (breaches.length > 0) status = "failed";
  else if (targetReached && minDaysMet) status = "passed";
  else status = "active";

  return {
    status,
    breaches,
    netPnl: cum,
    profitPct: start > 0 ? (cum / start) * 100 : 0,
    currentEquity: equity,
    peakEquity,
    maxDrawdownPct: start > 0 ? ((start - minEquity) / start) * 100 : 0,
    worstDay,
    daysTraded,
    targetReached,
    minDaysMet,
    dailyLossLimit,
    maxLossFloor,
    profitTargetAmount,
  };
}

export function ruleLabel(rule: FtmoRule): string {
  return rule === "daily_loss" ? "Max dnevni gubitak" : "Max ukupni gubitak";
}
