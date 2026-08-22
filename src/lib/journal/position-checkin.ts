// Client-safe types for the per-position daily check-in, mirroring the shape of
// `tracker-types.ts` — closed sets that match the DB CHECK, so a value the
// database would refuse cannot be constructed here either.

/**
 * Did the reason for holding this position survive today?
 *
 * Three states rather than a boolean because the middle one is where a swing
 * position actually spends its time. "Weakened" is the honest reading when the
 * setup is still technically alive but the evidence for it has thinned — and it
 * is the state worth being able to group on later, since holding through it is
 * a decision, not an oversight.
 */
export const THESIS_STATES = ["intact", "weakened", "invalidated"] as const;
export type ThesisState = (typeof THESIS_STATES)[number];

export const THESIS_STATE_LABELS: Record<ThesisState, string> = {
  intact: "Netaknuta",
  weakened: "Oslabljena",
  invalidated: "Poništena",
};

/**
 * What was done to the position today.
 *
 * This replaces the day-level `micromanage` column, and the four values are not
 * a straight copy of the old three: `added` exists because scaling into a
 * position mid-hold is a distinct act from moving a stop, and lumping it under
 * "touched" would hide the one that changes risk.
 */
export const TOUCHED_STATES = [
  "untouched",
  "stop_moved",
  "partial_exit",
  "added",
] as const;
export type TouchedState = (typeof TOUCHED_STATES)[number];

export const TOUCHED_LABELS: Record<TouchedState, string> = {
  untouched: "Nisam dirao",
  stop_moved: "Pomerio stop",
  partial_exit: "Delimičan izlazak",
  added: "Dodao",
};

export type PositionCheckin = {
  id: string;
  position_id: string;
  report_date: string;
  thesis_state: ThesisState | null;
  touched: TouchedState | null;
  note: string | null;
};

/**
 * Interventions ranked by how far they moved the risk you signed up for.
 *
 * Needed because a multi-day hold can carry a different answer on each of its
 * days, and a report grouping on "was this position managed" has to collapse
 * them into one. The order is not severity-of-outcome — it is distance from the
 * plan as it was written:
 *
 *   added        — takes on exposure the plan never sized for. Furthest.
 *   stop_moved   — changes the loss that was agreed before entry.
 *   partial_exit — a deviation, but toward less risk, not more.
 *   untouched    — the plan, executed.
 *
 * Reported as the FURTHEST reached across the hold: touching a position once in
 * five days is the fact worth grouping on, and averaging it away would hide it.
 */
export const TOUCHED_SEVERITY: Record<TouchedState, number> = {
  untouched: 0,
  partial_exit: 1,
  stop_moved: 2,
  added: 3,
};

/** The furthest-from-plan state across a hold, or null if never answered. */
export function worstTouched(
  states: readonly (TouchedState | null)[],
): TouchedState | null {
  let worst: TouchedState | null = null;
  for (const s of states) {
    if (s == null) continue;
    if (worst == null || TOUCHED_SEVERITY[s] > TOUCHED_SEVERITY[worst]) worst = s;
  }
  return worst;
}

/**
 * States that mean the position was interfered with.
 *
 * `untouched` is the only one that is not — and a row with no answer at all is
 * not interference either, it is silence. Both fall outside.
 */
export function isInterference(touched: TouchedState | null): boolean {
  return touched != null && touched !== "untouched";
}
