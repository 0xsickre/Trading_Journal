/**
 * Per-account cost defaults, applied when a new execution row is created.
 *
 * These are suggestions, not authority: the value lands in the field and the
 * user overwrites it whenever the broker charged something else. Nothing here
 * ever recomputes a fill that has already been saved.
 */

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
 * Swap accrues per unit per night held. Charged as a cost, so the result is
 * negative when a rate is configured — matching how brokers report it and how
 * `net_pl` subtracts it.
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

/** Whole nights between two instants. Same-day round trips pay no swap. */
export function nightsBetween(
  fromISO: string | null | undefined,
  toISO: string | null | undefined,
): number {
  if (!fromISO || !toISO) return 0;
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
  return Math.floor((to - from) / 86_400_000);
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  // Normalize -0: a zero-night, zero-fee row should render as "0", not "-0".
  return r === 0 ? 0 : r;
}
