/**
 * Per-account cost defaults, applied when a new execution row is created.
 *
 * These are suggestions, not authority: the value lands in the field and the
 * user overwrites it whenever the broker charged something else. Nothing here
 * ever recomputes a fill that has already been saved.
 */

import { DEFAULT_TZ, toEpoch, zonedDateKey } from "./time";

export type CostDefaults = {
  default_commission_per_unit: number;
  default_fee_fixed: number;
  default_swap_per_day: number;
};

export const NO_COST_DEFAULTS: CostDefaults = {
  default_commission_per_unit: 0,
  default_fee_fixed: 0,
  default_swap_per_day: 0,
};

/** Commission scales with size; the fixed fee is charged once per fill. */
export function prefillFee(
  qty: number,
  defaults: CostDefaults = NO_COST_DEFAULTS,
): number {
  const units = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const fee =
    units * defaults.default_commission_per_unit + defaults.default_fee_fixed;
  return round2(fee);
}

/**
 * Swap accrues per unit per night held.
 *
 * Sign follows the schema, not the broker statement: `net_pl` is
 * `gross − fees − swap`, so a POSITIVE value is a cost and a negative one is a
 * credit you earned on the carry. The configured rate is entered the same way,
 * and the result is simply rate × units × nights with no sign flip.
 */
export function prefillSwap(
  qty: number,
  nightsHeld: number,
  defaults: CostDefaults = NO_COST_DEFAULTS,
): number {
  const units = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const nights = Number.isFinite(nightsHeld) && nightsHeld > 0 ? nightsHeld : 0;
  return round2(units * nights * defaults.default_swap_per_day);
}

/**
 * Nights a position was held through, in the account's timezone.
 *
 * Counts CALENDAR rollovers, not elapsed 24-hour blocks. That is how swap is
 * actually charged — once per rollover the position is open across — and it is
 * what the name has always claimed. Counting elapsed 24s undercharged a
 * position opened late and closed early: held 23:00 Monday to 01:00 Wednesday,
 * it crossed two rollovers but measured 26 hours and billed one night.
 *
 * Same-day round trips still pay nothing.
 */
export function nightsBetween(
  fromISO: string | null | undefined,
  toISO: string | null | undefined,
  tz: string = DEFAULT_TZ,
): number {
  if (!fromISO || !toISO) return 0;
  const from = toEpoch(fromISO);
  const to = toEpoch(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;

  const fromKey = zonedDateKey(fromISO, tz);
  const toKey = zonedDateKey(toISO, tz);
  if (!fromKey || !toKey) return 0;

  return Math.max(0, Math.round((dayKeyToUtc(toKey) - dayKeyToUtc(fromKey)) / 86_400_000));
}

/** "yyyy-MM-dd" to a UTC midnight, purely so two day keys can be subtracted. */
function dayKeyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  // Normalize -0: a zero-night, zero-fee row should render as "0", not "-0".
  return r === 0 ? 0 : r;
}
