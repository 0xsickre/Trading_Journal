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
};

export const NO_COST_DEFAULTS: CostDefaults = {
  default_commission_per_unit: 0,
  default_fee_fixed: 0,
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

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  // Normalize -0: a zero-fee row should render as "0", not "-0".
  return r === 0 ? 0 : r;
}
