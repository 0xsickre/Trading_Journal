import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { DailyReport } from "./daily-report";
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
  return (data as DailyReport | null) ?? null;
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
 * The two prose fields are read and thrown away, kept only as "was anything
 * written". That is a deliberate trade: it reads more than it ships. A month is
 * at most 31 rows, so the read is cheap, while shipping the notes themselves
 * would put a page of prose per day on the wire to draw one dot.
 */
export type DailyReportListRow = {
  report_date: string;
  mental_temp: number | null;
  no_trade_day: boolean;
  impulse_fomo: boolean;
  impulse_fear: boolean;
  impulse_greed: boolean;
  impulse_fear_wrong: boolean;
  locked: boolean;
  hasNote: boolean;
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
    impulse_fomo: boolean;
    impulse_fear: boolean;
    impulse_greed: boolean;
    impulse_fear_wrong: boolean;
    locked_at: string | null;
    macro_note: string | null;
    impulse_note: string | null;
  }>((lo, hi) =>
    supabase
      .from("tj_daily_reports")
      .select(
        "report_date, mental_temp, no_trade_day, impulse_fomo, impulse_fear, impulse_greed, impulse_fear_wrong, locked_at, macro_note, impulse_note",
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
    impulse_fomo: r.impulse_fomo,
    impulse_fear: r.impulse_fear,
    impulse_greed: r.impulse_greed,
    impulse_fear_wrong: r.impulse_fear_wrong,
    locked: r.locked_at != null,
    hasNote:
      (r.macro_note ?? "").trim() !== "" || (r.impulse_note ?? "").trim() !== "",
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
      .select("report_date, mental_temp, no_trade_day")
      .order("report_date", { ascending: false })
      .range(from, to),
  );
  return data as DailyReportLite[];
}
