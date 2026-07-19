import type { TradeRow } from "./types";
import { zonedDateKey, zonedWeekStartKey } from "./time";
import { slippageFromTrade } from "./entry-slippage";
import { exitEfficiencyFromTrade } from "./exit-efficiency";

export type PnlMode = "net" | "gross";

export type RealizedTrade = {
  id: string;
  closedAt: string | null;
  net: number;
  gross: number;
  r: number | null;
  result: string | null;
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
      result: (t.result as string) ?? null,
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
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancy: number; // in R
  best: number;
  worst: number;
  maxWinStreak: number;
  maxLossStreak: number;
  maxDrawdown: number; // money, on chosen pnl mode
};

export function computeStats(
  trades: RealizedTrade[],
  mode: PnlMode = "net",
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
    best = -Infinity,
    worst = Infinity,
    maxWin = 0,
    maxLoss = 0,
    curWin = 0,
    curLoss = 0,
    rCount = 0,
    posProfit = 0,
    negProfit = 0;

  let cum = 0;
  let peak = 0;
  let maxDd = 0;

  for (const t of trades) {
    const p = pnl(t);
    grossSum += t.gross;
    netSum += t.net;
    if (t.r != null) {
      totalR += t.r;
      rCount++;
    }
    if (p > 0) {
      wins++;
      if (t.r != null) {
        winRSum += t.r;
        winRCount++;
      }
      posProfit += p;
      curWin++;
      curLoss = 0;
    } else if (p < 0) {
      losses++;
      if (t.r != null) {
        lossRSum += t.r;
        lossRCount++;
      }
      negProfit += Math.abs(p);
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

    cum += p;
    peak = Math.max(peak, cum);
    maxDd = Math.min(maxDd, cum - peak);
  }

  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const avgR = rCount > 0 ? totalR / rCount : 0;
  const avgWin = winRCount > 0 ? winRSum / winRCount : 0;
  const avgLoss = lossRCount > 0 ? lossRSum / lossRCount : 0;
  const profitFactor = negProfit > 0 ? posProfit / negProfit : posProfit > 0 ? null : 0;
  const lossRate = 100 - winRate;
  const expectancy =
    (winRate / 100) * avgWin + (lossRate / 100) * avgLoss; // in R

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
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
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
    const s = computeStats(arr, "net");
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
