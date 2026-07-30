/**
 * The Sickre Score's seventh component.
 *
 * Two signals, both already computed elsewhere: the tracker's daily compliance
 * (this phase) and the playbook follow rate (Phase 4). Neither is redesigned
 * here — this only blends them.
 */

export const PROCESS_BLEND = { tracker: 60, follow: 40 } as const;

export type ProcessInputs = {
  /** Mean of daily compliance percentages over the scoring window. */
  trackerPct: number | null;
  /** Share of answered playbook rules that were followed. */
  followRatePct: number | null;
};

/**
 * Blend the two into one 0–100 figure, or null when neither exists.
 *
 * **Both null → null.** `computeSickreScore` already drops a null component and
 * renormalizes over the rest, so this returns null rather than inventing a 0. A
 * trader with no tracker history and no answered playbook rules has an
 * UNMEASURED process, not a bad one.
 *
 * **One null → the other, unblended.** Returning "the other × its weight" would
 * score a trader with a flawless tracker and no playbook answers at 60/100 and
 * call it a process problem. Renormalizing over the inputs that exist is the
 * same policy the score applies one level up; using a different one on either
 * side of that boundary is how a score becomes unexplainable.
 *
 * **60/40 toward the tracker.** It covers every day including the ones you did
 * not trade, and its automatic half is derived from data you cannot fudge. The
 * follow rate exists only on days you traded and only over rules you bothered
 * to answer — a narrower and more gameable signal. The weights are a constant
 * so recalibrating means editing a table, not rewriting a formula.
 */
export function processAdherence(
  input: ProcessInputs,
  weights: { tracker: number; follow: number } = PROCESS_BLEND,
): number | null {
  const { trackerPct: t, followRatePct: f } = input;

  // `!= null` deliberately, not a truthiness check: 0 is a real, terrible score
  // and must not be treated as missing.
  if (t == null && f == null) return null;
  if (t == null) return f;
  if (f == null) return t;

  const total = weights.tracker + weights.follow;
  if (total <= 0) return (t + f) / 2;
  return (t * weights.tracker + f * weights.follow) / total;
}
