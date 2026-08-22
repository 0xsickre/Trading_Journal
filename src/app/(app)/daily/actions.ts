"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { THESIS_STATES, TOUCHED_STATES } from "@/lib/journal/position-checkin";

// Eight fields, down from twenty-one. What left did not move here — it moved to
// the position (`micromanage`, now `savePositionCheckin` below) or to the weekly
// review (the grade and the debrief prose). What stayed is what a day mid-hold
// can honestly answer.
const dailyReportSchema = z.object({
  mental_temp: z.number().int().min(1).max(5).nullable(),
  macro_note: z.string().nullable(),
  impulse_fomo: z.boolean(),
  impulse_fear: z.boolean(),
  impulse_greed: z.boolean(),
  impulse_fear_wrong: z.boolean(),
  impulse_note: z.string().nullable(),
  no_trade_day: z.boolean(),
});

export type SaveDailyReportInput = z.infer<typeof dailyReportSchema>;

const positionCheckinSchema = z.object({
  position_id: z.string().uuid(),
  thesis_state: z.enum(THESIS_STATES).nullable(),
  touched: z.enum(TOUCHED_STATES).nullable(),
  note: z.string().nullable(),
});

export type SavePositionCheckinInput = z.infer<typeof positionCheckinSchema>;

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    macro_note: emptyToNull(parsed.data.macro_note),
    impulse_note: emptyToNull(parsed.data.impulse_note),
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

/**
 * One position's answers for one day.
 *
 * Saved on its own rather than folded into `saveDailyReport`, for the same
 * reason the tracker checklist writes as you tick it: a check-in is three taps
 * and is worth persisting the moment it is given. A trader who answers two
 * positions and closes the tab should not lose both to an unpressed Save.
 *
 * The lock is checked here for the message, and enforced by
 * `tj_position_checkin_lock_guard` for real — PostgREST with the user's JWT is a
 * live write path, so a check in this file alone is a lock you can walk around.
 */
export async function savePositionCheckin(
  reportDate: string,
  input: SavePositionCheckinInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = positionCheckinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  const { data: existing } = await supabase
    .from("tj_daily_reports")
    .select("locked_at")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (existing?.locked_at != null)
    return { ok: false, error: "Ovaj dan je zaključan i više se ne menja." };

  const { error } = await supabase.from("tj_position_checkins").upsert(
    {
      user_id: user.id,
      position_id: parsed.data.position_id,
      report_date: reportDate,
      thesis_state: parsed.data.thesis_state,
      touched: parsed.data.touched,
      note: emptyToNull(parsed.data.note),
    },
    { onConflict: "position_id,report_date" },
  );
  if (error) return { ok: false, error: error.message };

  revalidateDaily();
  return { ok: true };
}

function emptyToNull(s: string | null): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

export async function saveFocusGoal(
  goalText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = goalText.trim();
  if (!text) return { ok: false, error: "Fokus cilj ne može biti prazan." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
