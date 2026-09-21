/**
 * The plan, as it stood the moment the money went on.
 *
 * THE HOLE THIS CLOSES. The day locks. The week locks. The trade plan never
 * did: `entry_price`, `stop_price`, `target_price`, `thesis`, `invalidation`,
 * `time_stop_days` and `risk_pct` stayed editable forever, with no history. And
 * every "plan versus reality" figure is built on them — entry slippage, target
 * attainment, delta R, the `thesis_written` rule. On a single-user system that
 * makes the whole comparison falsifiable by the only person it measures: move
 * the stop after the fact and the slippage improves.
 *
 * A SNAPSHOT, NOT A LOCK — and the difference matters. A lock forbids the edit,
 * which sounds stricter and is not: it only moves the edit to "unlock, then
 * change", and in the meantime it blocks the honest correction of a typo. The
 * snapshot instead makes the correction HARMLESS to the measurement. The
 * figures read what was sealed at entry, so they cannot be improved after the
 * outcome is known; the live fields stay editable so the trade can still be
 * made accurate; and an edit made after the seal is stamped
 * (`plan_amended_at`), so the screen can say it happened.
 *
 * THREE RULES, the same three `equity-at-entry.ts` follows, for the same
 * reasons:
 *
 *   1. **Written once, when the trade first has an entry fill.** A plan that
 *      was never entered has nothing to seal.
 *   2. **Never overwritten.** A later edit is an amendment, not a new plan.
 *   3. **Cleared on the way back to `planned`.** A save that removes the last
 *      fill turns the position back into an idea, and an idea must not carry
 *      an entry's seal.
 *
 * `{}` — the empty patch — means "say nothing", and the dynamic UPDATE inside
 * `tj_save_trade` then never names the columns.
 */

import type { Json } from "@/lib/supabase/types";
import { numberFieldValue, stringFieldValue } from "./field-values";
import type { PositionStatus } from "./trade-lifecycle";
import type { TradeRow } from "./types";

/**
 * The fields a plan consists of.
 *
 * These and no others: what was decided BEFORE the entry. `position_size` and
 * `direction` are derived, `conviction` has no field on the form at all, and
 * the tags are a description of the setup rather than a commitment about it.
 */
export const PLAN_FIELDS = [
  "entry_price",
  "stop_price",
  "target_price",
  "risk_pct",
  "time_stop_days",
  "thesis",
  "invalidation",
  "scale_out_levels",
] as const;

export type PlanField = (typeof PLAN_FIELDS)[number];

/**
 * A sealed plan: the same keys, holding what they held at entry.
 *
 * Typed as `Json` rather than `unknown` because that is what the column is —
 * the patch goes straight into a jsonb write, and an `unknown` here would have
 * to be cast back at every call site instead of once, here, where the widening
 * happens.
 */
export type PlanSnapshot = Partial<Record<PlanField, Json | null>>;

/** Statuses that mean the position has been entered. */
const ENTERED: ReadonlySet<PositionStatus> = new Set<PositionStatus>([
  "open",
  "partial",
  "closed",
]);

/** The plan fields as they stand on a row right now. */
export function planFieldsOf(row: Pick<TradeRow, never> & Record<string, unknown>): PlanSnapshot {
  const out: PlanSnapshot = {};
  for (const key of PLAN_FIELDS) {
    const v = (row as Record<string, unknown>)[key];
    // `undefined` is "the caller did not send this column", which is not the
    // same as a plan that deliberately left the field empty. Only the second
    // belongs in a snapshot.
    if (v !== undefined) out[key] = (v ?? null) as Json | null;
  }
  return out;
}

export function planSnapshotPatch(
  nextStatus: PositionStatus,
  prev: { plan_snapshot: unknown } | null,
  /** The plan as this save leaves it. */
  plan: PlanSnapshot,
  now: string = new Date().toISOString(),
): { plan_snapshot?: PlanSnapshot | null; plan_sealed_at?: string | null } {
  const sealed = (prev?.plan_snapshot ?? null) as PlanSnapshot | null;

  if (!ENTERED.has(nextStatus)) {
    // Rule 3, and only when there is something to clear: an untouched plan must
    // not produce a write on every save.
    return sealed == null ? {} : { plan_snapshot: null, plan_sealed_at: null };
  }

  // Rule 2: what was sealed is the record, whatever the form says today.
  if (sealed != null) return {};

  // Rule 1. A trade entered with nothing planned at all seals an empty plan
  // rather than nothing: "there was no plan" is itself the finding, and a null
  // snapshot would read as "this trade predates the column".
  return { plan_snapshot: plan, plan_sealed_at: now };
}

/**
 * Which sealed fields the live row no longer agrees with.
 *
 * Compared by VALUE, not by whether the save mentioned the column: the trade
 * form sends every plan field on every save, so "the payload named it" would
 * mark an amendment each time the notes were edited.
 */
export function planAmendments(
  sealed: PlanSnapshot | null | undefined,
  row: Record<string, unknown>,
): PlanField[] {
  if (!sealed) return [];
  const out: PlanField[] = [];
  for (const key of PLAN_FIELDS) {
    if (!(key in sealed)) continue;
    if (!sameValue(sealed[key], row[key] ?? null)) out.push(key);
  }
  return out;
}

/** Stamps the amendment time when, and only when, something actually moved. */
export function planAmendedPatch(
  sealed: PlanSnapshot | null | undefined,
  nextPlan: PlanSnapshot,
  prevAmendedAt: string | null,
  now: string = new Date().toISOString(),
): { plan_amended_at?: string | null } {
  if (!sealed) return {};
  const changed = planAmendments(sealed, nextPlan as Record<string, unknown>);
  if (changed.length === 0) return {};
  // Already stamped: the badge says "amended after entry", not "amended twice".
  return prevAmendedAt != null ? {} : { plan_amended_at: now };
}

/**
 * THE one place that decides whether a figure reads the seal or the live row.
 *
 * Every "plan versus reality" number must ask this and nothing else. Five
 * readers with five fallbacks would be five different numbers for one trade —
 * which is the failure this whole module exists to prevent, arriving by
 * another door.
 *
 * A trade with no seal (everything before this shipped, and every plan that was
 * never entered) falls back to the live fields, because there is nothing else
 * to read and refusing would blank the history.
 */
export function sealedPlan(row: TradeRow): PlanSnapshot {
  const sealed = (row as Record<string, unknown>).plan_snapshot as PlanSnapshot | null;
  return sealed ?? planFieldsOf(row as unknown as Record<string, unknown>);
}

/** A planned price as it was sealed — the entry every slippage is measured from. */
export function sealedNumber(row: TradeRow, key: PlanField): number | null {
  const plan = sealedPlan(row);
  if (!(key in plan)) return numberFieldValue(row, key);
  const v = plan[key];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A planned text field as it was sealed — `thesis`, `invalidation`. */
export function sealedText(row: TradeRow, key: PlanField): string | null {
  const plan = sealedPlan(row);
  if (!(key in plan)) return stringFieldValue(row, key);
  const v = plan[key];
  return typeof v === "string" ? v : v == null ? null : String(v);
}

/**
 * A sealed field in the shape it was stored in — for `scale_out_levels`, which
 * is a list rather than a number or a line of text.
 *
 * Like its two siblings, a key the seal does not carry falls back to the live
 * column: a seal taken by an import holds only what the file knew, and the rest
 * of the plan is still the row's own.
 */
export function sealedValue(row: TradeRow, key: PlanField): unknown {
  const plan = sealedPlan(row);
  return key in plan ? plan[key] : (row as Record<string, unknown>)[key];
}

/** Loose equality that treats null, undefined and "" as the same absence. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v == null || v === "" ? null : v);
  const x = norm(a);
  const y = norm(b);
  if (x == null || y == null) return x === y;
  if (typeof x === "number" || typeof y === "number") return Number(x) === Number(y);
  // Arrays and objects (scale-out levels): compared as JSON, which is how they
  // were stored and how they come back.
  if (typeof x === "object" || typeof y === "object")
    return JSON.stringify(x) === JSON.stringify(y);
  return String(x) === String(y);
}
