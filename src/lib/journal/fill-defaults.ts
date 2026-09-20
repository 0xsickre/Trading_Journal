/**
 * What a new fill's QUANTITY box opens with.
 *
 * The sibling of `cost-defaults.ts`: that one suggests what a fill costs, this
 * one suggests how big it is. Both are suggestions — the trader overwrites
 * them, and an import replaces the fills wholesale.
 *
 * The plan computes a position size from risk, stop and the instrument's
 * contract value, prints it on screen ("4.78 lots") and then, until now, let
 * the execution tab open its first entry fill with a hard-coded `1`. A number
 * nobody computed, in the box that decides the size of the trade AND multiplies
 * the commission prefill.
 *
 * Quantities are counted in the unit `position_size` is counted in — lots, or
 * contracts on a futures symbol. See `units.ts:sizeUnitLabel`.
 */

/** A hair of tolerance, so 4.78 − (0.1 + 0.2 + 4.48) does not read as open. */
const EPSILON = 1e-9;

/**
 * A quantity as the Qty input should hold it.
 *
 * Four decimals, matching what the form already writes into `position_size`, so
 * the number in the box and the number in the column are the same number. The
 * `Number(...)` round-trip is what removes float dust: 4.78 stays "4.78" and
 * 2.7800000000000002 becomes "2.78" rather than reaching the user as a
 * seventeen-digit quantity.
 */
export function qtyToInput(qty: number): string {
  if (!Number.isFinite(qty)) return "";
  return String(Number(qty.toFixed(4)));
}

/**
 * The size this trade PLANNED, or null when it planned none.
 *
 * The stored field wins over the live suggestion: once a size is on the trade it
 * is a record of a decision, and re-deriving it from today's equity would let
 * the plan drift after the fact. The suggestion stands in only while the field
 * is still empty — exactly the order the submit handler uses when it decides
 * whether to write the suggestion into `position_size`.
 *
 * Null, never 0 and never 1. A trade with no instrument spec cannot be sized,
 * and the caller must be able to tell that from "sized at zero".
 */
export function plannedSize(
  positionSizeField: unknown,
  sizeSuggestion: number | null,
): number | null {
  const stored =
    typeof positionSizeField === "number"
      ? positionSizeField
      : typeof positionSizeField === "string" && positionSizeField.trim() !== ""
        ? Number(positionSizeField)
        : null;
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored;
  if (sizeSuggestion != null && Number.isFinite(sizeSuggestion) && sizeSuggestion > 0) {
    return sizeSuggestion;
  }
  return null;
}

/**
 * What goes in the Qty box of a fill the trader just added.
 *
 * An ENTRY opens with what is left of the plan — the planned size minus what is
 * already filled, not the whole plan. Adding to a position is a second entry
 * fill, and offering the full 4.78 again would silently propose doubling it.
 *
 * An EXIT opens with what is still open — entries minus exits. One click is
 * therefore a full close, which is the common case, and typing over it is a
 * partial. It can never propose closing more than was opened, which is the
 * rule `validateFills` enforces at save time.
 *
 * An empty string when there is nothing to suggest: no plan, or nothing left.
 * Never a 1. A calculator that cannot answer must return no answer — the same
 * reason `computePositionSize` refuses to size without a contract spec. The
 * save path already refuses an incomplete fill by number, so an empty box costs
 * the trader a message, not a wrong trade.
 */
export function seedFillQty(params: {
  side: "entry" | "exit";
  plannedSize: number | null;
  entryQty: number;
  exitQty: number;
}): string {
  const { side, plannedSize: planned, entryQty, exitQty } = params;
  if (side === "exit") {
    const open = entryQty - exitQty;
    return open > EPSILON ? qtyToInput(open) : "";
  }
  if (planned == null) return "";
  const left = planned - entryQty;
  return left > EPSILON ? qtyToInput(left) : "";
}

/**
 * How the filled size compares to the planned one, in words — or null when
 * there is nothing to say.
 *
 * Deliberately NOT a refusal. A broker statement is the truth about what was
 * traded, and an import replaces the fills without consulting the plan; a
 * trader who meant to size down mid-entry is allowed to. What sizing deviation
 * must not do is go UNSEEN, because it is the one number the plan promised and
 * the execution quietly changed.
 */
export function sizeDeviationNote(params: {
  plannedSize: number | null;
  entryQty: number;
  unit: string;
}): string | null {
  const { plannedSize: planned, entryQty, unit } = params;
  if (planned == null || entryQty <= 0) return null;
  // Compared at the precision the plan is shown at: a suggestion printed as
  // 4.78 and filled at 4.78 must not be reported as a deviation of 0.0003.
  if (Math.abs(entryQty - planned) < 0.005) return null;
  return `Filled ${entryQty.toFixed(2)} of a planned ${planned.toFixed(2)} ${unit}.`;
}
