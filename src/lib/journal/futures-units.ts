/**
 * Points and ticks for the dashboard (U1/U2, trader 01.10.2026).
 *
 * A trade's points are its money divided by the money one point of ONE contract
 * is worth — so they count every contract: two MNQ over ten points is twenty
 * points, the same $40 the money says. A sum of them is then a sum of money in
 * another unit, which is why a book may add them up at all (U1).
 *
 * Only inside one family, though: an NQ point is $20 and an ES point $50, so
 * "points" across both describe nothing. The micro counts with its mini (MNQ
 * with NQ) because they quote the same price (U2).
 */

import type { RealizedTrade } from "./analytics";
import { MINI_OF } from "./default-instruments";
import { normalizeInstrumentSymbol } from "./instrument-aliases";

export type FuturesUnit = "points" | "ticks";

/**
 * The family a symbol belongs to: the mini's symbol for a CME micro (MNQZ6 → NQ),
 * the canonical symbol for anything else. Null without a symbol.
 */
export function instrumentFamily(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  const s = normalizeInstrumentSymbol(symbol);
  if (!s) return null;
  return MINI_OF[s] ?? s;
}

/** The families present, in first-seen order. */
export function familiesOf(trades: readonly RealizedTrade[]): string[] {
  const out: string[] = [];
  for (const t of trades) {
    const f = instrumentFamily(t.row.instrument);
    if (f != null && !out.includes(f)) out.push(f);
  }
  return out;
}

type UnitStats = { point_value?: number | null; tick_size?: number | null; fx_rate?: number | null } | null;

/**
 * Units per unit of account money for one trade: 1 ÷ (point value × FX rate) for
 * points, and that ÷ the tick size for ticks — the inverse of how the money was
 * made (`gross_points × point_value × fx_rate`). Null when the trade lacks either.
 */
export function unitFactor(stats: UnitStats | undefined, unit: FuturesUnit): number | null {
  const pv = stats?.point_value ?? 0;
  const fx = stats?.fx_rate ?? 1;
  if (!(pv > 0) || !(fx > 0)) return null;
  if (unit === "points") return 1 / (pv * fx);
  const tick = stats?.tick_size ?? 0;
  return tick > 0 ? 1 / (pv * fx * tick) : null;
}

/**
 * The trades with their money in points or ticks — net, gross and fees, so every
 * figure built from them reads in the unit. Null unless every trade is of ONE
 * family and has what its conversion needs: a figure in half points and half
 * dollars would print as points.
 */
export function toUnits(trades: readonly RealizedTrade[], unit: FuturesUnit): RealizedTrade[] | null {
  if (trades.length === 0 || familiesOf(trades).length !== 1) return null;
  const out: RealizedTrade[] = [];
  for (const t of trades) {
    if (instrumentFamily(t.row.instrument) == null) return null;
    const f = unitFactor(t.row.stats, unit);
    if (f == null) return null;
    const stats = t.row.stats && { ...t.row.stats, total_fees: (t.row.stats.total_fees ?? 0) * f };
    out.push({ ...t, net: t.net * f, gross: t.gross * f, row: { ...t.row, stats } });
  }
  return out;
}
