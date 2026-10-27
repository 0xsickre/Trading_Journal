import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { opportunitiesOf, stateText, type DailyReport } from "./daily-report";
import type { DailyReportLite } from "./insights/context";

export async function getDailyReport(
  reportDate: string,
): Promise<DailyReport | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_daily_reports")
    .select("*")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (!data) return null;
  // jsonb: read defensively, so the form never meets a malformed row.
  return { ...(data as DailyReport), opportunities: opportunitiesOf(data.opportunities) };
}

/**
 * The last "sutra menjam" written before this day (phase G): what the day
 * opens with on /daily. The latest one before it, not literally yesterday's —
 * Monday opens with Friday's.
 */
export async function getLastTomorrowChange(
  beforeDate: string,
): Promise<{ report_date: string; text: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_daily_reports")
    .select("report_date, tomorrow_change")
    .lt("report_date", beforeDate)
    .not("tomorrow_change", "is", null)
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = data?.tomorrow_change?.trim();
  return data && text ? { report_date: data.report_date, text } : null;
}

/**
 * Dates that have a journal entry — the join between journaling and the metrics
 * engine, feeding "Logged days". Only the dates are read: the metric asks
 * whether the day was written up, not what it said.
 */
export async function getDailyReportDates(): Promise<string[]> {
  const supabase = await createClient();
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_daily_reports")
      .select("report_date")
      .order("report_date", { ascending: false })
      .range(from, to),
  );
  return data.map((r) => r.report_date);
}

/**
 * One day's journal, as the month list shows it.
 *
 * `DailyReportLite` is not enough — it carries neither the impulses nor
 * `locked_at`, and a list whose whole point is the journal's CONTENT cannot
 * omit the four flags the reader ticked.
 *
 * Phase E dropped the macro note, the four impulse booleans and the impulse
 * note from the table itself. What the list shows of a day is its state before
 * the session (phase G) — or, on an older day, the retired mental rating —
 * whether it was a rest day, and the lock.
 */
export type DailyReportListRow = {
  report_date: string;
  mental_temp: number | null;
  no_trade_day: boolean;
  locked: boolean;
  /** The day's emotions (phase B5); optional for callers that list days only. */
  psychology_tags?: string[];
  /** The state before the session (phase G), as one line; null when not written. */
  state?: string | null;
};

/**
 * Journals for a date range, for the month list.
 *
 * Ranged, not "all" like the two above: those feed engines that need the whole
 * history, this feeds one month on screen. Draining the table to draw thirty
 * rows is the kind of query that is free on a new account and slow on a real
 * one.
 */
export async function getDailyReportsInRange(
  from: string,
  to: string,
): Promise<DailyReportListRow[]> {
  const supabase = await createClient();
  const data = await selectAllPages<{
    report_date: string;
    mental_temp: number | null;
    no_trade_day: boolean;
    locked_at: string | null;
    psychology_tags: string[] | null;
    sleep_quality_pct: number | null;
    sleep_hours: number | null;
    work_shift: string | null;
    with_child: boolean | null;
  }>((lo, hi) =>
    supabase
      .from("tj_daily_reports")
      .select(
        "report_date, mental_temp, no_trade_day, locked_at, psychology_tags, sleep_quality_pct, sleep_hours, work_shift, with_child",
      )
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date")
      .range(lo, hi),
  );

  return data.map((r) => ({
    report_date: r.report_date,
    mental_temp: r.mental_temp,
    no_trade_day: r.no_trade_day,
    locked: r.locked_at != null,
    psychology_tags: r.psychology_tags ?? [],
    state: stateText(r),
  }));
}

/**
 * The journal fields the insight engine joins against — process state, not the
 * prose. Reading only these keeps the dashboard payload small.
 */
export async function getDailyReportsLite(): Promise<DailyReportLite[]> {
  const supabase = await createClient();
  const data = await selectAllPages((from, to) =>
    supabase
      .from("tj_daily_reports")
      .select(
        "report_date, mental_temp, no_trade_day, locked_at, mental_temp_at, psychology_tags, sleep_quality_pct, sleep_hours, work_shift, with_child, state_at, tomorrow_change, opportunities",
      )
      .order("report_date", { ascending: false })
      .range(from, to),
  );
  return data as DailyReportLite[];
}
