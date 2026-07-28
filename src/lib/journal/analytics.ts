import type { TradeRow } from "./types";
import { zonedDateKey, zonedWeekStartKey } from "./time";
import { slippageFromTrade } from "./entry-slippage";
import { exitEfficiencyFromTrade } from "./exit-efficiency";
import { classifyOutcome, EXACT_ZERO_RANGE, type BreakevenRange } from "./breakeven";
import { buildBalanceTimeline, computeDrawdown } from "./balance";

export type PnlMode = "net" | "gross";

export type RealizedTrade = {
  id: string;
  closedAt: string | null;
  net: number;
  gross: number;
  r: number | null;
  row: TradeRow;
};

export type ToRealizedOptions = {
  /** Include partial exits (default: closed positions only). */
  includePartial?: boolean;
};

/** Trades with realized P/L — default: fully closed positions only. */
export function toRealized(
  trades: TradeRow[],
  options: ToRealizedOptions = {},
): RealizedTrade[] {
  const { includePartial = false } = options;
  return trades
    .filter((t) => {
      if (!t.stats || t.stats.net_pl == null) return false;
      if (includePartial) return true;
      return t.status === "closed";
    })
    .map((t) => ({
      id: t.id,
      closedAt: t.stats!.closed_at,
      net: t.stats!.net_pl ?? 0,
      gross: t.stats!.gross_pl ?? 0,
      r: t.stats!.realized_r,
      row: t,
    }))
    .sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""));
}

export type Stats = {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number; // %
  grossSum: number;
  netSum: number;
  totalR: number;
  avgR: number;
  /**
   * Average R of winners / losers. Named for their unit: these are R-multiples,
   * not money, and they only cover trades that HAVE an R (which requires a stop
   * price). `avgLossR` is negative.
   */
  avgWinR: number;
  avgLossR: number;
  /** Average money of winners / losers, over every decided trade. */
  avgWinMoney: number;
  avgLossMoney: number;
  /**
   * Gross profit / gross loss. `Infinity` when there were winners and no
   * losses — a real, maximal value — and `null` only when there is nothing to
   * divide, so a consumer can tell "perfect" from "no data".
   */
  profitFactor: number | null;
  /** Expected R per trade, over the trades that carry an R. */
  expectancy: number;
  /** How many trades the expectancy is based on. */
  expectancySample: number;
  best: number;
  worst: number;
  maxWinStreak: number;
  maxLossStreak: number;
  maxDrawdown: number; // money, on chosen pnl mode
};

/**
 * Portfolio statistics over realized trades.
 *
 * `range` is the account's breakeven band. Note the deliberate split: trade
 * COUNTS (wins / losses / breakeven, and therefore win rate) respect the band,
 * but MONEY SUMS use the actual sign of each trade. A -12.40 fee-only trade is
 * counted as breakeven yet its 12.40 still lands in gross loss — otherwise
 * profit factor would be quietly overstated and the parts would stop adding up
 * to net P&L.
 */
export function computeStats(
  trades: RealizedTrade[],
  mode: PnlMode = "net",
  range: BreakevenRange = EXACT_ZERO_RANGE,
): Stats {
  const pnl = (t: RealizedTrade) => (mode === "net" ? t.net : t.gross);
  const count = trades.length;
  let wins = 0,
    losses = 0,
    be = 0,
    grossSum = 0,
    netSum = 0,
    totalR = 0,
    winRSum = 0,
    lossRSum = 0,
    winRCount = 0,
    lossRCount = 0,
    winMoneySum = 0,
    lossMoneySum = 0,
    best = -Infinity,
    worst = Infinity,
    maxWin = 0,
    maxLoss = 0,
    curWin = 0,
    curLoss = 0,
    rCount = 0,
    posProfit = 0,
    negProfit = 0;

  for (const t of trades) {
    const p = pnl(t);
    grossSum += t.gross;
    netSum += t.net;
    if (t.r != null) {
      totalR += t.r;
      rCount++;
    }

    // Money always follows the sign, regardless of how the band labels the trade.
    if (p > 0) posProfit += p;
    else if (p < 0) negProfit += Math.abs(p);

    const outcome = classifyOutcome(p, range);
    if (outcome === "win") {
      wins++;
      winMoneySum += p;
      if (t.r != null) {
        winRSum += t.r;
        winRCount++;
      }
      curWin++;
      curLoss = 0;
    } else if (outcome === "loss") {
      losses++;
      lossMoneySum += p;
      if (t.r != null) {
        lossRSum += t.r;
        lossRCount++;
      }
      curLoss++;
      curWin = 0;
    } else {
      be++;
      curWin = 0;
      curLoss = 0;
    }
    maxWin = Math.max(maxWin, curWin);
    maxLoss = Math.max(maxLoss, curLoss);
    best = Math.max(best, p);
    worst = Math.min(worst, p);
  }

  // Drawdown has one implementation (balance.ts) so the $ figure here and the
  // % figure on the dashboard can never drift apart.
  const maxDd = computeDrawdown(
    buildBalanceTimeline(
      0,
      trades.map((t) => ({ at: t.closedAt ?? "", pnl: pnl(t) })),
    ),
  ).maxMoney;

  // Win/loss is classified by realized money (p > 0 / p < 0), independent of the
  // user-entered `result` label. Breakeven (p === 0) is excluded from winRate's
  // denominator, so winRate + lossRate === 100 among decided trades only.
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const avgR = rCount > 0 ? totalR / rCount : 0;
  const avgWinR = winRCount > 0 ? winRSum / winRCount : 0;
  const avgLossR = lossRCount > 0 ? lossRSum / lossRCount : 0;
  const avgWinMoney = wins > 0 ? winMoneySum / wins : 0;
  const avgLossMoney = losses > 0 ? lossMoneySum / losses : 0;

  // Infinity, not null, when a book has winners and no losses: that is a real
  // maximal profit factor, and collapsing it into "no data" made the composite
  // score DROP its heaviest component for the one book that maxed it.
  const profitFactor =
    negProfit > 0 ? posProfit / negProfit : posProfit > 0 ? Infinity : null;

  // Expectancy is in R, so every term must come from the R population — only
  // trades with a stop price have an R. Weighting R averages by a win rate
  // drawn from ALL decided trades mixed two different samples, and a trader
  // who records stops on half their trades got a number describing neither.
  const rDecided = winRCount + lossRCount;
  const rWinRate = rDecided > 0 ? winRCount / rDecided : 0;
  const expectancy =
    rDecided > 0 ? rWinRate * avgWinR + (1 - rWinRate) * avgLossR : 0;

  return {
    count,
    wins,
    losses,
    breakeven: be,
    winRate,
    grossSum,
    netSum,
    totalR,
    avgR,
    avgWinR,
    avgLossR,
    avgWinMoney,
    avgLossMoney,
    profitFactor,
    expectancy,
    expectancySample: rDecided,
    best: count ? best : 0,
    worst: count ? worst : 0,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    maxDrawdown: maxDd,
  };
}

export type EquityPoint = { i: number; label: string; value: number };

export function buildEquity(
  trades: RealizedTrade[],
  mode: PnlMode,
  metric: "money" | "r",
  startBalance = 0,
): EquityPoint[] {
  let cum = metric === "money" ? startBalance : 0;
  const out: EquityPoint[] = [
    { i: 0, label: "Start", value: cum },
  ];
  trades.forEach((t, idx) => {
    const delta =
      metric === "money" ? (mode === "net" ? t.net : t.gross) : t.r ?? 0;
    cum += delta;
    out.push({
      i: idx + 1,
      label: t.closedAt ?? String(idx + 1),
      value: Number(cum.toFixed(2)),
    });
  });
  return out;
}

export type RBucket = { bucket: string; count: number };

export function rHistogram(trades: RealizedTrade[]): RBucket[] {
  const edges = [-3, -2, -1, 0, 1, 2, 3, 4, 5];
  const labels = [
    "<-3",
    "-3..-2",
    "-2..-1",
    "-1..0",
    "0..1",
    "1..2",
    "2..3",
    "3..4",
    "4..5",
    ">5",
  ];
  const counts = new Array(labels.length).fill(0);
  for (const t of trades) {
    if (t.r == null) continue;
    let idx = edges.findIndex((e) => t.r! < e);
    if (idx === -1) idx = labels.length - 1;
    counts[idx]++;
  }
  return labels.map((bucket, i) => ({ bucket, count: counts[i] }));
}

/** date(NY) -> summed pnl, for the calendar heatmap. */
export function dailyPnl(
  trades: RealizedTrade[],
  mode: PnlMode,
  tzOf: (t: RealizedTrade) => string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trades) {
    if (!t.closedAt) continue;
    const key = zonedDateKey(t.closedAt, tzOf(t));
    const p = mode === "net" ? t.net : t.gross;
    m.set(key, (m.get(key) ?? 0) + p);
  }
  return m;
}

export type BreakdownRow = {
  key: string;
  count: number;
  winRate: number;
  totalR: number;
  avgR: number;
  netSum: number;
};

const ARRAY_BREAKDOWN_FIELDS = new Set([
  "technical_tags",
  "psychology_tags",
]);

/** Group realized trades by a position field (tag) -> performance. */
export function breakdownByField(
  trades: RealizedTrade[],
  field: string,
  range: BreakevenRange = EXACT_ZERO_RANGE,
): BreakdownRow[] {
  const groups = new Map<string, RealizedTrade[]>();
  for (const t of trades) {
    const raw = t.row[field];
    const keys: string[] =
      ARRAY_BREAKDOWN_FIELDS.has(field) && Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string" && !!x)
        : [typeof raw === "string" && raw ? raw : "—"];
    if (keys.length === 0) keys.push("—");
    for (const key of keys) {
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }
  }
  const rows: BreakdownRow[] = [];
  for (const [key, arr] of groups) {
    const s = computeStats(arr, "net", range);
    rows.push({
      key,
      count: arr.length,
      winRate: s.winRate,
      totalR: s.totalR,
      avgR: s.avgR,
      netSum: s.netSum,
    });
  }
  return rows.sort((a, b) => b.netSum - a.netSum);
}

export type SlippageStats = {
  count: number;
  avgAdverseR: number;
  totalAdverseR: number;
};

/** Aggregate entry slippage in R (positive adverseR = cost). */
export function computeSlippageStats(trades: RealizedTrade[]): SlippageStats {
  let count = 0;
  let totalAdverseR = 0;
  for (const t of trades) {
    const slip = slippageFromTrade(t.row);
    if (slip?.slippageR == null) continue;
    count++;
    totalAdverseR += slip.slippageR;
  }
  return {
    count,
    avgAdverseR: count > 0 ? totalAdverseR / count : 0,
    totalAdverseR,
  };
}

export type WeeklySlippageRow = {
  week: string;
  avgSlipR: number;
  tradeCount: number;
};

/** Average adverse entry slippage (R) per calendar week in account TZ. */
export function weeklySlippageR(
  trades: RealizedTrade[],
  tzOf: (t: RealizedTrade) => string,
): WeeklySlippageRow[] {
  const buckets = new Map<string, number[]>();
  for (const t of trades) {
    const ref = t.closedAt ?? t.row.created_at;
    if (!ref) continue;
    const slip = slippageFromTrade(t.row);
    if (slip?.slippageR == null) continue;
    const week = zonedWeekStartKey(ref, tzOf(t));
    if (!week) continue;
    const arr = buckets.get(week) ?? [];
    arr.push(slip.slippageR);
    buckets.set(week, arr);
  }
  return [...buckets.entries()]
    .map(([week, rs]) => ({
      week,
      avgSlipR: rs.reduce((a, b) => a + b, 0) / rs.length,
      tradeCount: rs.length,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

export type ExitEfficiencyStats = {
  count: number;
  avgPct: number;
  winnerCount: number;
  avgWinnerPct: number;
};

export function computeExitEfficiencyStats(
  trades: RealizedTrade[],
): ExitEfficiencyStats {
  let count = 0;
  let sumPct = 0;
  let winnerCount = 0;
  let winnerSumPct = 0;
  for (const t of trades) {
    const eff = exitEfficiencyFromTrade(t.row);
    if (eff == null) continue;
    count++;
    sumPct += eff.pct;
    if (eff.realizedR > 0) {
      winnerCount++;
      winnerSumPct += eff.pct;
    }
  }
  return {
    count,
    avgPct: count > 0 ? sumPct / count : 0,
    winnerCount,
    avgWinnerPct: winnerCount > 0 ? winnerSumPct / winnerCount : 0,
  };
}

export type WeeklyExitEffRow = {
  week: string;
  avgPct: number;
  tradeCount: number;
};

export function weeklyExitEfficiency(
  trades: RealizedTrade[],
  tzOf: (t: RealizedTrade) => string,
): WeeklyExitEffRow[] {
  const buckets = new Map<string, number[]>();
  for (const t of trades) {
    const ref = t.closedAt ?? t.row.created_at;
    if (!ref) continue;
    const eff = exitEfficiencyFromTrade(t.row);
    if (eff == null) continue;
    const week = zonedWeekStartKey(ref, tzOf(t));
    if (!week) continue;
    const arr = buckets.get(week) ?? [];
    arr.push(eff.pct);
    buckets.set(week, arr);
  }
  return [...buckets.entries()]
    .map(([week, pcts]) => ({
      week,
      avgPct: pcts.reduce((a, b) => a + b, 0) / pcts.length,
      tradeCount: pcts.length,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}
