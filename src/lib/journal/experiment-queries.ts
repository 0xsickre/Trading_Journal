import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Experiment } from "./experiments";

/**
 * True when PostgREST says the TABLE is not there.
 *
 * The same tolerance `saveWeeklyReview` applies to a column that has not
 * shipped yet, one level up: the migration is applied by hand, and until it is,
 * the weekly review must still open. An experiment card that is missing is a
 * feature that has not arrived; a weekly page that throws is a page the trader
 * cannot use at all.
 */
function missingTable(error: { code?: string; message: string } | null): boolean {
  return (
    error != null &&
    (error.code === "PGRST205" ||
      /could not find the table .*tj_experiments/i.test(error.message) ||
      /relation .*tj_experiments.* does not exist/i.test(error.message))
  );
}

/**
 * Every experiment, newest first.
 *
 * All of them rather than the running one: a finished experiment is the half of
 * this feature worth keeping — "I tried that in March and it did nothing" is
 * the sentence a journal exists to be able to say.
 */
export async function getExperiments(): Promise<Experiment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tj_experiments")
    .select("id, started_week, hypothesis, metric_key, baseline_weeks, ended_week, status")
    .order("started_week", { ascending: false });

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as Experiment[];
}
