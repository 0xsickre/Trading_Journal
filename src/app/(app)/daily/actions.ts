"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { isValidDayKey, todayFor } from "@/lib/journal/time";
import { dailyReportSchema, type SaveDailyReportInput } from "@/lib/journal/daily-report-schema";

/**
 * The day being written must exist and must have started.
 *
 * The tracker actions already refused a future day; these two did not, so a
 * report could be saved against next week — or against
 * "2026-02-30" — through a direct call. Same rule, same sentence, same clock:
 * the primary account's today.
 */
async function dayError(reportDate: string): Promise<string | null> {
  if (!isValidDayKey(reportDate)) return "Neispravan datum.";
  const account = await getPrimaryAccount();
  if (reportDate > todayFor(account))
    return "Budući dan još nije počeo.";
  return null;
}

// What a day saves — the state before the session, the rest-day flag, the
// day's emotions and its close — is defined in `daily-report-schema.ts` (phase
// G), where it is tested. The debrief prose and the Douglas impulse checkboxes
// left in phase E; the 1–5 mental rating in phase G (G-2).

function revalidateDaily() {
  revalidatePath("/daily");
}

export async function saveDailyReport(
  reportDate: string,
  input: SaveDailyReportInput,
): Promise<
  | { ok: true; updated_at: string }
  | { ok: false; error: string }
> {
  const parsed = dailyReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
  }
  const badDay = await dayError(reportDate);
  if (badDay) return { ok: false, error: badDay };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  // Checked so the user sees this sentence rather than the trigger's. The trigger
  // stays the real guard — PostgREST with the user's JWT is a live write path, so
  // a check here alone is a lock you can walk around.
  const { data: existing } = await supabase
    .from("tj_daily_reports")
    .select("locked_at")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (existing?.locked_at != null)
    return { ok: false, error: "Ovaj dan je zaključan i više se ne menja." };

  const row = {
    user_id: user.id,
    report_date: reportDate,
    ...parsed.data,
  };

  const { data, error } = await supabase
    .from("tj_daily_reports")
    .upsert(row, { onConflict: "user_id,report_date" })
    .select("updated_at")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidateDaily();
  return { ok: true, updated_at: data.updated_at };
}
