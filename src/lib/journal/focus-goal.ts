import { differenceInCalendarDays, parseISO } from "date-fns";

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

/** Day count on active goal (1-based on start day). */
export function daysOnActiveGoal(
  goal: Pick<FocusGoal, "started_at">,
  asOfDate: string,
): number {
  const days = differenceInCalendarDays(parseISO(asOfDate), parseISO(goal.started_at));
  return Math.max(1, days + 1);
}
