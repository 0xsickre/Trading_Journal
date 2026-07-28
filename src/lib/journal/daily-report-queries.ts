import "server-only";
import { createClient } from "@/lib/supabase/server";
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
  const { data } = await supabase
    .from("tj_daily_reports")
    .select("report_date")
    .order("report_date", { ascending: false });
  return (data ?? []).map((r) => r.report_date as string);
}

/**
 * The journal fields the insight engine joins against — process state, not the
 * prose. Reading only these keeps the dashboard payload small.
 */
export async function getDailyReportsLite(): Promise<DailyReportLite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_daily_reports")
    .select("report_date, micromanage, mental_temp, day_grade, rule_broken, no_trade_day")
    .order("report_date", { ascending: false });
  return (data ?? []) as DailyReportLite[];
}
