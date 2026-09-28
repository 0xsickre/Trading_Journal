/**
 * The weekend review in six answers — what a day trader actually reads to get
 * better, and nothing they would scroll past.
 *
 *   1. Setups: R per setup (playbook) → which to keep, which to drop.
 *   2. Mistakes: what each mistake cost, in money and R → one rule for next week.
 *   3. Discipline: A trades against B/C → what following the plan is worth.
 *   4. Hour of entry → when to trade and when to stay out.
 *   5. MAE/MFE: how deep winners went before working (stop too wide or tight)
 *      and how much of the move was kept (exits too early).
 *   6. Trade number in the day, and the trade after a loss → a daily limit.
 *
 * Everything but the setup, the grade and the mistake comes off the fills, so
 * it costs the trader nothing to record. Pure — the page passes this week's and
 * last week's trades, and progress is the difference.
 */
import type { EnrichedTrade } from "./enriched-trade";
import { arrayFieldValue, numberFieldValue } from "./field-values";
import { gradeFromRating, NO_MISTAKE } from "./quick-log";

export type ProgressRow = {
  key: string;
  label: string;
  n: number;
  net: number;
  /** Mean realized R over the trades that have one (a stop); null when none do. */
  avgR: number | null;
  sumR: number;
  /** Share of wins, 0–1. */
  winRate: number;
};

export type ProgressSummary = {
  total: ProgressRow;
  setups: ProgressRow[];
  mistakes: ProgressRow[];
  grades: ProgressRow[];
  hours: ProgressRow[];
  order: ProgressRow[];
  afterLoss: ProgressRow | null;
  excursion: {
    /** Mean MAE in R of the WINNERS — how much heat a trade that worked needed. */
    winnersMaeR: number | null;
    /** Mean MFE in R of the LOSERS — how far in profit a loser was before it lost. */
    losersMfeR: number | null;
    /** Mean share of the best move kept, winners only, in % (`excursion.ts` capturePct). */
    capture: number | null;
    n: number;
  };
};

function row(key: string, label: string, trades: EnrichedTrade[]): ProgressRow {
  const rs = trades.map((t) => t.r).filter((r): r is number => r != null && Number.isFinite(r));
  return {
    key,
    label,
    n: trades.length,
    net: trades.reduce((s, t) => s + t.pnl, 0),
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    sumR: rs.reduce((a, b) => a + b, 0),
    winRate: trades.length ? trades.filter((t) => t.outcome === "win").length / trades.length : 0,
  };
}

function groupRows(
  trades: EnrichedTrade[],
  keysOf: (t: EnrichedTrade) => string[],
  labelOf: (key: string) => string,
): ProgressRow[] {
  const groups = new Map<string, EnrichedTrade[]>();
  for (const t of trades) {
    for (const k of keysOf(t)) groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()].map(([k, ts]) => row(k, labelOf(k), ts));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const openMs = (t: EnrichedTrade) => Date.parse(t.openedAt ?? t.closedAt ?? "") || 0;

export function buildProgress(
  trades: EnrichedTrade[],
  playbookNames: Record<string, string>,
): ProgressSummary {
  // 1. Setups, best R first; trades with no setup last, under their own name.
  const setups = groupRows(
    trades,
    (t) => [String(t.trade.row.playbook_id ?? "") || "none"],
    (k) => (k === "none" ? "No setup" : (playbookNames[k] ?? "Deleted setup")),
  ).sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : (b.avgR ?? -Infinity) - (a.avgR ?? -Infinity)));

  // 2. Mistakes, most expensive first. A trade with two mistakes counts in both.
  const mistakes = groupRows(
    trades,
    (t) => (arrayFieldValue(t.trade.row, "mistake") ?? []).filter((m) => m && m !== NO_MISTAKE),
    (k) => k,
  ).sort((a, b) => a.net - b.net);

  // 3. By plan or not.
  const grades = groupRows(
    trades,
    (t) => {
      const g = gradeFromRating(numberFieldValue(t.trade.row, "execution_rating"));
      return [g == null ? "none" : g === "A" ? "A" : "BC"];
    },
    (k) => ({ A: "A — by plan", BC: "B/C — off plan", none: "Not graded" })[k] ?? k,
  ).sort((a, b) => ["A", "BC", "none"].indexOf(a.key) - ["A", "BC", "none"].indexOf(b.key));

  // 4. Hour of entry on the account's clock.
  const hours = groupRows(
    trades.filter((t) => t.openHour != null),
    (t) => [String(t.openHour).padStart(2, "0")],
    (k) => `${k}:00–${k}:59`,
  ).sort((a, b) => a.key.localeCompare(b.key));

  // 6. Trade number within its day, and the trade right after a loss that day.
  const byDay = new Map<string, EnrichedTrade[]>();
  for (const t of trades) byDay.set(t.openDay, [...(byDay.get(t.openDay) ?? []), t]);
  const nth = new Map<string, number>();
  const afterLoss: EnrichedTrade[] = [];
  for (const day of byDay.values()) {
    const ordered = [...day].sort((a, b) => openMs(a) - openMs(b));
    ordered.forEach((t, i) => {
      nth.set(t.id, i + 1);
      if (i > 0 && ordered[i - 1].outcome === "loss") afterLoss.push(t);
    });
  }
  const order = groupRows(
    trades,
    (t) => [String(Math.min(nth.get(t.id) ?? 1, 3))],
    (k) => (k === "3" ? "3rd and later" : k === "1" ? "1st of the day" : "2nd of the day"),
  ).sort((a, b) => a.key.localeCompare(b.key));

  // 5. Excursions, where the trade has them (R2 fills them for futures).
  const withExc = trades.filter((t) => t.excursion.maeR != null || t.excursion.mfeR != null);
  const winners = withExc.filter((t) => t.outcome === "win");
  const losers = withExc.filter((t) => t.outcome === "loss");

  return {
    total: row("all", "All trades", trades),
    setups,
    mistakes,
    grades,
    hours,
    order,
    afterLoss: afterLoss.length ? row("after_loss", "After a loss that day", afterLoss) : null,
    excursion: {
      winnersMaeR: mean(winners.map((t) => t.excursion.maeR).filter((x): x is number => x != null)),
      losersMfeR: mean(losers.map((t) => t.excursion.mfeR).filter((x): x is number => x != null)),
      capture: mean(winners.map((t) => t.excursion.capturePct).filter((x): x is number => x != null)),
      n: withExc.length,
    },
  };
}
