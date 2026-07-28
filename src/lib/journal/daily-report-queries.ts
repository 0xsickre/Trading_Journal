import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DailyReport } from "./daily-report";

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
