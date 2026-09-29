/**
 * What the broker charges, per instrument — commission.
 *
 * WHY PER INSTRUMENT. Topstep charges a different round turn per contract
 * (MNQ is not NQ), so one account-wide number is wrong for all but one symbol.
 * A future carries no overnight financing, so there is no swap here (H2, I3).
 *
 * EVERYTHING IS PER LOT — per contract — because that is the unit the journal
 * stores (`position_size`; `point_value` is the money one full point of price
 * is worth for ONE contract).
 *
 * The functions are pure and take plain numbers, so the same arithmetic runs
 * in the trade form, in the import and in a test.
 */

/** The contract facts a cost calculation needs. */
export type InstrumentCostSpec = {
  /** Money per 1.00 of price movement, for one lot. */
  point_value: number;
  /** The smallest price step. */
  tick_size: number | null;
  /** Money per lot, per side. The forex convention here. */
  commission_per_lot: number;
  /** Percent of notional, per side. The metals convention here. */
  commission_pct: number;
};

/**
 * What the position is worth at `price`, for `lots` lots.
 *
 * `point_value` doubles as the contract size, because it IS the contract size:
 * one lot of gold is 100 ounces and one full dollar of price is worth 100 USD
 * on it. The same identity holds for an FX lot (100 000) and for the index (1).
 */
export function notionalValue(lots: number, spec: Pick<InstrumentCostSpec, "point_value">, price: number): number {
  if (!Number.isFinite(lots) || !Number.isFinite(price)) return 0;
  return Math.abs(lots) * spec.point_value * Math.abs(price);
}

/**
 * Commission for ONE side of the trade — the entry or the exit.
 *
 * The broker charges "in/out", so a round turn pays this twice; the round trip
 * is not folded in here because a journal records fills, and a fill is one
 * side. Returns money in the instrument's own commission currency.
 */
export function commissionPerSide(
  spec: Pick<InstrumentCostSpec, "point_value" | "commission_per_lot" | "commission_pct">,
  lots: number,
  price: number,
): number {
  if (!Number.isFinite(lots) || lots <= 0) return 0;
  const perLot = spec.commission_per_lot > 0 ? spec.commission_per_lot * lots : 0;
  const pct =
    spec.commission_pct > 0 ? (notionalValue(lots, spec, price) * spec.commission_pct) / 100 : 0;
  return round2(perLot + pct);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
