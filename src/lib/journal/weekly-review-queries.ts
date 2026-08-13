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
