import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseSessionBrief, type SessionBrief } from "./session-brief";

/**
 * True when PostgREST says the TABLE is not there.
 *
 * `tj_session_briefs` arrives by a migration applied by hand, and `main` is
 * deployed on push: until the migration runs, `/daily` must still open and read
 * "the brief has not arrived" — the same tolerance `experiment-queries.ts` has.
 */
function missingTable(error: { code?: string; message: string } | null): boolean {
  return (
    error != null &&
    (error.code === "PGRST205" ||
      /could not find the table .*tj_session_briefs/i.test(error.message) ||
      /relation .*tj_session_briefs.* does not exist/i.test(error.message))
  );
}

/** The briefs of the Topstep days `from`–`to` (inclusive), oldest first. Unreadable rows are left out. */
export async function getSessionBriefs(from: string, to: string): Promise<SessionBrief[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tj_session_briefs")
    .select("trading_day, flat_by, day_note, red_windows, ranges, source_url")
    .gte("trading_day", from)
    .lte("trading_day", to)
    .order("trading_day");

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(parseSessionBrief).filter((b): b is SessionBrief => b != null);
}
