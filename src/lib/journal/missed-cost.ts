/**
 * What the trades you did not take were worth.
 *
 * THE ONLY MISTAKE IN THIS BOOK THAT WAS FREE. A loss is money. A broken rule
 * is a tracker verdict. A bad exit is target attainment. Hesitation — a plan
 * written, marked missed, and never taken — cost nothing, which made it the
 * cheapest mistake to keep making.
 *
 * NOT IN THE METRICS REGISTRY, and that is deliberate. `toRealized` requires a
 * `net_pl` and `status = 'closed'`, so a missed trade is not in the report set
 * at all; adding it there would mean loosening the one filter that keeps every
 * figure on `/reports` about money that actually moved. This is its own small
 * path, read from the rows directly.
 *
 * MEASURABLE IS NOT THE SAME AS MEASURED. `missed_r` is written by
 * `scripts/mt5_excursion.py --missed` from price history, and most books will
 * have it on some trades and not others. The unmeasured ones are COUNTED and
 * said out loud rather than summed as zero — the same refusal `portfolio-heat`
 * makes for a position with no stop. Without the script, the panel's honest
 * output is "7 missed, none of them measured", which is still worth reading.
 *
 * AND IT MEASURES DISCIPLINE, NOT ONLY HESITATION. A plan that was never
 * marked missed stays `planned` forever (`stalePlan` already says so), so this
 * number grows only as fast as old plans are resolved. A book that never marks
 * anything missed reads as "nothing missed", which is why the panel states the
 * count of stale plans beside it rather than letting the sum stand alone.
 */

import { numberFieldValue, stringFieldValue } from "./field-values";
import type { TradeRow } from "./types";

/** What the plan would have met first. */
export type MissedOutcome = "target" | "stop" | "neither";

export type MissedTrade = {
  id: string;
  label: string;
  instrument: string | null;
  reason: string | null;
  outcome: MissedOutcome | null;
  /** Hypothetical R; null when nothing has measured this one. */
  r: number | null;
};

export type MissedCost = {
  trades: MissedTrade[];
  /** How many carry a measured R. */
  measured: number;
  /** How many do not — counted, never summed as zero. */
  unmeasured: number;
  /** Sum of R over the measured ones; null when none are. */
  totalR: number | null;
  /** Measured R summed per `miss_reason`, worst first. */
  byReason: { reason: string; totalR: number; n: number }[];
  /** How many of the measured ones would have hit their target. */
  wouldHaveWorked: number;
};

const OUTCOMES: ReadonlySet<string> = new Set(["target", "stop", "neither"]);

/** The rows this panel is about: plans that were marked missed. */
export function missedRows(rows: readonly TradeRow[]): TradeRow[] {
  return rows.filter((r) => String(r.status) === "missed");
}

export function missedCost(rows: readonly TradeRow[]): MissedCost {
  const trades: MissedTrade[] = missedRows(rows).map((row) => {
    const raw = stringFieldValue(row, "missed_outcome");
    const outcome = raw != null && OUTCOMES.has(raw) ? (raw as MissedOutcome) : null;
    const r = numberFieldValue(row, "missed_r");
    return {
      id: row.id,
      label: row.trade_no != null ? `#${row.trade_no}` : row.id.slice(0, 8),
      instrument: (row.instrument as string) ?? null,
      reason: stringFieldValue(row, "miss_reason"),
      outcome,
      // An R without an outcome is half a measurement, and the pair is what the
      // database's own CHECK keeps coherent. Reading one without the other
      // would let a stray number into the sum.
      r: outcome != null && r != null ? r : null,
    };
  });

  const measured = trades.filter((t) => t.r != null);
  const byReason = new Map<string, { totalR: number; n: number }>();
  for (const t of measured) {
    // A miss with no reason recorded is its own group. Folding it into the
    // others would attribute it to a cause nobody named.
    const key = t.reason ?? "";
    const cur = byReason.get(key) ?? { totalR: 0, n: 0 };
    cur.totalR += t.r as number;
    cur.n += 1;
    byReason.set(key, cur);
  }

  return {
    trades,
    measured: measured.length,
    unmeasured: trades.length - measured.length,
    totalR:
      measured.length > 0 ? measured.reduce((s, t) => s + (t.r as number), 0) : null,
    byReason: [...byReason.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      // Most expensive first — and for a sum of R, "most expensive" is the
      // biggest number, because a missed WINNER is what a miss costs.
      .sort((a, b) => b.totalR - a.totalR || a.reason.localeCompare(b.reason)),
    wouldHaveWorked: measured.filter((t) => t.outcome === "target").length,
  };
}

/**
 * Plans that were never resolved — neither taken nor marked missed.
 *
 * The denominator this panel needs to be honest about itself: a book that
 * never marks anything missed has a missed cost of zero for the wrong reason.
 * `olderThanDays` is counted against the day the plan was written.
 */
export function stalePlanCount(
  rows: readonly TradeRow[],
  todayKey: string,
  olderThanDays = 14,
): number {
  let n = 0;
  for (const row of rows) {
    if (String(row.status) !== "planned") continue;
    const day = String(row.created_at ?? "").slice(0, 10);
    if (day === "" || daysBetween(day, todayKey) < olderThanDays) continue;
    n++;
  }
  return n;
}

/** Whole days between two `YYYY-MM-DD` keys; negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
