"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { isValidDayKey, todayFor } from "@/lib/journal/time";

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

// Two fields, down from twenty-one.
//
// Most of what left moved rather than died: to the weekly review (the grade and
// the debrief prose); the per-position check-in that took `micromanage` went
// with the swing book (H1, 28.09.2026). Phase E took the last six — the macro note and
// the four Douglas impulse checkboxes with their note — because nothing ever
// READ them: no dimension, no insight rule, no metric. The same question is
// already asked where it can be grouped and counted, as `psychology_tags` on
// the trade.
//
// What is left is a pre-market gate rather than a diary: how is your head, and
// are you opening anything new today.
const dailyReportSchema = z.object({
  mental_temp: z.number().int().min(1).max(5).nullable(),
  no_trade_day: z.boolean(),
});

export type SaveDailyReportInput = z.infer<typeof dailyReportSchema>;

function revalidateDaily() {
  revalidatePath("/daily");
}

export async function saveDailyReport(
  reportDate: string,
  input: SaveDailyReportInput,
): Promise<
  | { ok: true; updated_at: string; warnNoFocusGoal?: boolean }
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

  const { data: activeGoal } = await supabase
    .from("tj_focus_goals")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  // Warned on any saved day rather than on a grade being set: the grade is gone,
  // and the focus goal is now what the whole day is measured against, so a day
  // journalled without one is the case worth naming.
  const warnNoFocusGoal = !activeGoal ? true : undefined;

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
  return { ok: true, updated_at: data.updated_at, warnNoFocusGoal };
}

export async function saveFocusGoal(
  goalText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = goalText.trim();
  if (!text) return { ok: false, error: "Fokus cilj ne može biti prazan." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  const today = new Date().toISOString().slice(0, 10);

  const { data: current } = await supabase
    .from("tj_focus_goals")
    .select("id, goal_text")
    .eq("is_active", true)
    .maybeSingle();

  if (current?.goal_text === text) {
    return { ok: true };
  }

  if (current) {
    const { error: endErr } = await supabase
      .from("tj_focus_goals")
      .update({ is_active: false, ended_at: today })
      .eq("id", current.id);
    if (endErr) return { ok: false, error: endErr.message };
  }

  const { error } = await supabase.from("tj_focus_goals").insert({
    user_id: user.id,
    goal_text: text,
    started_at: today,
    is_active: true,
  });
  if (error) return { ok: false, error: error.message };

  revalidateDaily();
  return { ok: true };
}

export async function endFocusGoal(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: current } = await supabase
    .from("tj_focus_goals")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  if (!current) return { ok: false, error: "Nema aktivnog fokus cilja." };

  const { error } = await supabase
    .from("tj_focus_goals")
    .update({ is_active: false, ended_at: today })
    .eq("id", current.id);
  if (error) return { ok: false, error: error.message };

  revalidateDaily();
  return { ok: true };
}
