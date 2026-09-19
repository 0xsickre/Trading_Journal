import { addDaysToDayKey, isTradingDayKey } from "./time";

export type FocusGoal = {
  id: string;
  user_id: string;
  goal_text: string;
  started_at: string;
  is_active: boolean;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Trading days on the active goal, 1-based — Monday to Friday only.
 *
 * It counted calendar days, so a goal set on a Friday was "day 4" on Monday
 * after a weekend in which nothing could be practised. Weekends are skipped;
 * a goal started or read on a weekend still reads at least 1.
 */
export function daysOnActiveGoal(
  goal: Pick<FocusGoal, "started_at">,
  asOfDate: string,
): number {
  const start = goal.started_at.slice(0, 10);
  let n = 0;
  for (let d = start; d <= asOfDate; d = addDaysToDayKey(d, 1)) {
    if (isTradingDayKey(d)) n++;
  }
  return Math.max(1, n);
}
