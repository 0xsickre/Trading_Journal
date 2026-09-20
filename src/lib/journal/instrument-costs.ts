/**
 * What the broker charges, per instrument — commission and overnight swap.
 *
 * WHY PER INSTRUMENT. The account carried one commission and one swap rate for
 * everything, and a book of CFDs does not work that way: this broker charges
 * 2.50 USD per lot on forex, 0.0007 % of notional on gold and copper, and
 * nothing at all on the index. One number for all three is wrong for at least
 * two of them.
 *
 * EVERYTHING IS PER LOT, because that is the unit a CFD is traded in and the
 * unit the journal stores (`position_size` is lots; `point_value` is the money
 * one full point of price is worth for ONE lot — 100 000 for a 100k FX lot,
 * 100 for gold's 100-ounce lot, 1 for the index).
 *
 * Both functions are pure and take plain numbers, so the same arithmetic runs
 * in the trade form, in the import and in a test.
 */

import { isoWeekdayOfDayKey, addDaysToDayKey } from "./time";

/** The contract facts a cost calculation needs. */
export type InstrumentCostSpec = {
  /** Money per 1.00 of price movement, for one lot. */
  point_value: number;
  /** The smallest price step — one "point" in the broker's swap table. */
  tick_size: number | null;
  /** Money per lot, per side. The forex convention here. */
  commission_per_lot: number;
  /** Percent of notional, per side. The metals convention here. */
  commission_pct: number;
  /** Swap in POINTS per lot, per night. Negative is a cost, positive a credit. */
  swap_long: number;
  swap_short: number;
  /**
   * The ISO weekday whose night is charged three times (3 = Wednesday for
   * forex and metals, 5 = Friday for this broker's index). It is how the
   * weekend's carry is collected while the market is shut.
   */
  swap_triple_day: number;
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

/**
 * The nights a hold is actually charged for, with the triple day counted three
 * times.
 *
 * A "night" is the rollover that BEGINS on a given day, so a position open
 * across Wednesday's rollover pays Wednesday's triple — which is how the
 * broker's own table reads ("Wednesday 3"). Saturday and Sunday are skipped:
 * the market is shut, and the weekend's carry is exactly what the triple day
 * collects. Counting it again would bill the weekend twice.
 */
export function swapNights(openDay: string, closeDay: string, tripleDay: number): number {
  if (!openDay || !closeDay || closeDay <= openDay) return 0;
  let total = 0;
  for (let day = openDay; day < closeDay; day = addDaysToDayKey(day, 1)) {
    const dow = isoWeekdayOfDayKey(day);
    if (dow === 0 || dow >= 6) continue; // unparseable, or the market is shut
    total += dow === tripleDay ? 3 : 1;
  }
  return total;
}

/**
 * The swap charged over a hold, in the instrument's quote currency.
 *
 * The broker publishes swap IN POINTS, so the money is
 * `points × tick_size × point_value` per lot per night: −11.06 points on a
 * 100k EURUSD lot is −11.06 × 0.00001 × 100 000 = −11.06 USD, and −83 points on
 * gold is −83 × 0.01 × 100 = −83.00 USD.
 *
 * SIGN FOLLOWS THE SCHEMA, not the broker statement: `net_pl` is
 * `gross − fees − swap`, so the returned value is a COST when positive. A
 * broker's negative swap (money taken from you) therefore comes back positive.
 */
export function swapCharge(input: {
  spec: InstrumentCostSpec;
  lots: number;
  direction: "long" | "short";
  openDay: string;
  closeDay: string;
}): number {
  const { spec, lots, direction, openDay, closeDay } = input;
  const tick = spec.tick_size;
  if (!Number.isFinite(lots) || lots <= 0 || tick == null || tick <= 0) return 0;
  const nights = swapNights(openDay, closeDay, spec.swap_triple_day);
  if (nights === 0) return 0;
  const points = direction === "long" ? spec.swap_long : spec.swap_short;
  const credit = points * tick * spec.point_value * lots * nights;
  // `credit` is what the broker adds to the account; the schema stores the cost.
  return round2(-credit);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
