import { gradeFromRating, NO_MISTAKE } from "./quick-log";
import type { TerminalOrigin } from "./terminal-origin";

/**
 * Phase SP: a trade opened through the Terminal panel is judged BEFORE its result
 * is seen, so the result cannot colour the verdict. Three answers, all saved:
 * was the POI strong, was it by plan (the A / B / C grade), and the mistake — which
 * an A records itself as "Bez greške" and a B or C must name.
 *
 * Reads what is SAVED, not what is on screen: the result stays hidden until the
 * answers are in the database, never because a button was merely clicked.
 */
export function blindReviewHidden(t: {
  terminal: TerminalOrigin;
  missed: boolean;
  poiStrong: boolean | null;
  rating: number | null;
  mistake: readonly string[];
}): boolean {
  if (t.missed || t.terminal?.kind !== "terminal") return false;
  const grade = gradeFromRating(t.rating);
  if (t.poiStrong == null || grade == null) return true;
  const named = t.mistake.filter((m) => m !== NO_MISTAKE);
  return grade === "A" ? !t.mistake.includes(NO_MISTAKE) : named.length === 0;
}
