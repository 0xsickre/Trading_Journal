import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { WeeklyReview } from "./weekly-review";

export async function getWeeklyReview(
  weekStart: string,
): Promise<WeeklyReview | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_weekly_reviews")
    .select("*")
    .eq("week_start", weekStart)
    .maybeSingle();
  return (data as WeeklyReview | null) ?? null;
}

/**
 * Week start → the grade given in that week's review, for the `week_grade`
 * dimension.
 *
 * Two columns and no prose. The review's five text answers are written to be
 * read, not grouped on; shipping them to the browser so a report can print one
 * letter per row would be paying for the whole review to draw a bucket label.
 *
 * Ungraded weeks are skipped rather than stored as null — the dimension excludes
 * a trade whose week has no grade, and an entry mapping to null would have to be
 * unwound at every read.
 */
export async function getWeekGrades(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const rows = await selectAllPages<{
    week_start: string;
    week_grade: string | null;
  }>((from, to) =>
    supabase
      .from("tj_weekly_reviews")
      .select("week_start, week_grade")
      .order("week_start")
      .range(from, to),
  );

  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.week_grade) out.set(r.week_start, r.week_grade);
  }
  return out;
}

/**
 * Week starts that already have a review.
 *
 * Only the keys, and only so the navigation can mark which weeks are written up
 * — the same shape and the same reasoning as `getDailyReportDates`: the answer
 * wanted is whether the week was reviewed, not what the review said.
 */
export async function getReviewedWeekStarts(): Promise<string[]> {
  const supabase = await createClient();
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_weekly_reviews")
      .select("week_start")
      .order("week_start", { ascending: false })
      .range(from, to),
  );
  return data.map((r) => r.week_start);
}
