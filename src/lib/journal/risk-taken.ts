/**
 * Risk actually taken at entry — the number this journal measured everything
 * else against without ever measuring it.
 *
 * THE GAP THIS CLOSES. `tj_positions.risk_pct` is a TEXT column filled from a
 * dropdown: it records an INTENTION ("1%"). `position_size` is a number the
 * trader typed. Nothing compared the two, so a trade sized at three times the
 * intended risk was invisible unless it also lost — and `max_loss_per_trade`,
 * the only rule that could have caught it, grades the REALIZED loss on the
 * close day, by which time the risk is already over.
 *
 * WHY ALMOST NOTHING IS STORED. Every factor below is already frozen per trade:
 * the planned stop distance comes from prices on the row, `entry_qty` from the
 * fills, and `point_value` / `fx_rate` from `tj_position_stats`, which
 * COALESCEs the trade's own snapshot over the live instrument. The one fact
 * that cannot be reconstructed later is the account's equity on the day of
 * entry — it moves with every subsequent trade, deposit and correction. That
 * one is a column (`tj_positions.equity_at_entry`); everything here is derived
 * from inputs that were already immutable.
 *
 * The money chain is deliberately the same one `computePositionStats` uses for
 * `realized_r_net` (`position-stats.ts`, where it is a local named `riskMoney`
 * and is thrown away): `points × qty × point_value × fx_rate`. Two expressions
 * for the same quantity is how a trade becomes one risk on one screen and a
 * different risk on another.
 */

import { numberFieldValue } from "./field-values";
import { parseRiskPct } from "./plan-calculations";
import { plannedRiskPts } from "./position-stats";
import type { TradeRow } from "./types";

/**
 * How far the risk taken may sit from the risk chosen before it counts as a
 * miss, in percentage points of equity.
 *
 * 0.1 pp, not a relative tolerance: at the sizes this book trades, "1 %" and
 * "1.05 %" are the same decision rounded differently by lot granularity, while
 * "1 %" and "1.5 %" are not. A relative band would forgive half a percent of
 * equity on a 1 % trade and refuse a rounding error on a 0.25 % one.
 *
 * Exported so the single place to recalibrate is this constant rather than a
 * literal inside the tracker evaluator — the same treatment `CONSISTENCY_SCALE`
 * gets in `risk-metrics.ts`.
 */
export const RISK_INTENT_TOLERANCE = 0.1;

/**
 * What the stop was worth, in account currency, at the size actually entered.
 *
 * Null — never zero, never a guessed 1 — whenever any factor is unknown. A
 * trade with no stop has no measurable risk, and an instrument with no point
 * value cannot be priced at all; both must read as "not answered" rather than
 * as a confident small number. This is the same refusal `computePositionSize`
 * makes on a missing `point_value`.
 */
export function riskMoneyAtEntry(row: TradeRow): number | null {
  const stats = row.stats;
  if (!stats) return null;

  const riskPts = plannedRiskPts(
    numberFieldValue(row, "entry_price"),
    numberFieldValue(row, "stop_price"),
    stats.avg_entry,
  );
  if (riskPts == null) return null;

  const qty = stats.entry_qty;
  const pointValue = stats.point_value;
  const fxRate = stats.fx_rate;
  if (qty == null || !(qty > 0)) return null;
  if (pointValue == null || !(pointValue > 0)) return null;
  if (fxRate == null || !(fxRate > 0)) return null;

  return riskPts * qty * pointValue * fxRate;
}

/** Equity the entry day opened with, as frozen on the trade. */
export function equityAtEntry(row: TradeRow): number | null {
  const v = numberFieldValue(row, "equity_at_entry");
  return v != null && v > 0 ? v : null;
}

/**
 * Risk taken as a percentage of the equity the entry day opened with.
 *
 * The opening balance rather than the live figure, for the reason
 * `equity-ladder.ts` spells out: a denominator that moves with every close
 * inside the day gives the same trade two answers depending on when it is
 * asked.
 */
export function riskPctTaken(row: TradeRow): number | null {
  const money = riskMoneyAtEntry(row);
  const equity = equityAtEntry(row);
  if (money == null || equity == null) return null;
  return (money / equity) * 100;
}

/** The risk the trader chose from the dropdown, as a number. */
export function riskIntentPct(row: TradeRow): number | null {
  return parseRiskPct(
    (row as Record<string, unknown>).risk_pct as string | number | null,
  );
}

/**
 * Distance between the risk taken and the risk chosen, as an ABSOLUTE value.
 *
 * Unsigned on purpose. Averaged with its sign, a book that alternates between
 * half-size and double-size reads as perfectly disciplined, because the two
 * errors cancel. The question this answers is "how far off am I", and that has
 * no direction.
 */
export function riskIntentGap(row: TradeRow): number | null {
  const taken = riskPctTaken(row);
  const intent = riskIntentPct(row);
  if (taken == null || intent == null) return null;
  return Math.abs(taken - intent);
}

/** True when the trade sized itself within tolerance of its own plan. */
export function matchedRiskIntent(row: TradeRow): boolean | null {
  const gap = riskIntentGap(row);
  if (gap == null) return null;
  return gap <= RISK_INTENT_TOLERANCE;
}

/**
 * Spread of the risk taken across a set of trades — the sizing-discipline
 * number.
 *
 * Population standard deviation, not sample: these are all the trades in scope,
 * not a draw from a larger population. The same choice `consistencyScore`
 * documents.
 *
 * Null below two values: one trade has a spread of zero only in the sense that
 * there is nothing to spread, and rendering that as a perfect 0.00 % would
 * claim discipline from a single data point.
 */
export function riskDispersion(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}
