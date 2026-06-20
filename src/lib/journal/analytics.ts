import type { TradeRow } from "./types";
import { zonedDateKey } from "./time";

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

/** Trades that have at least one exit (realized P/L) — the basis for stats. */
export function toRealized(trades: TradeRow[]): RealizedTrade[] {
  return trades
    .filter((t) => t.stats && t.stats.net_pl != null)
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
    winSum = 0,
    lossSum = 0,
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
      winSum += t.r ?? 0;
      posProfit += p;
      curWin++;
      curLoss = 0;
    } else if (p < 0) {
      losses++;
      lossSum += t.r ?? 0;
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
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
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

/** Group realized trades by a position field (tag) -> performance. */
export function breakdownByField(
  trades: RealizedTrade[],
  field: string,
): BreakdownRow[] {
  const groups = new Map<string, RealizedTrade[]>();
  for (const t of trades) {
    const raw = t.row[field];
    const key = typeof raw === "string" && raw ? raw : "—";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
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
