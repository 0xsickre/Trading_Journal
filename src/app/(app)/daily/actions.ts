"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  DAY_GRADES,
  MARKET_TYPES,
  MICROMANAGE_OPTIONS,
} from "@/lib/journal/daily-report";

const dailyReportSchema = z.object({
  day_grade: z.enum(DAY_GRADES).nullable(),
  mental_temp: z.number().int().min(1).max(10).nullable(),
  sleep_quality: z.number().int().min(1).max(5).nullable(),
  macro_note: z.string().nullable(),
  mantra_series: z.boolean(),
  mantra_rules: z.boolean(),
  mantra_risk: z.boolean(),
  risk_accepted: z.boolean(),
  mental_rehearsal: z.string().nullable(),
  market_type: z.enum(MARKET_TYPES).nullable(),
  micromanage: z.enum(MICROMANAGE_OPTIONS).nullable(),
  impulse_fomo: z.boolean(),
  impulse_fear: z.boolean(),
  impulse_greed: z.boolean(),
  impulse_fear_wrong: z.boolean(),
  impulse_note: z.string().nullable(),
  rule_broken: z.boolean().nullable(),
  rule_broken_note: z.string().nullable(),
  learned_today: z.string().nullable(),
  tomorrow_change: z.string().nullable(),
  easiest_setup: z.string().nullable(),
  day_overview: z.string().nullable(),
  celebrate_win: z.string().nullable(),
  friday_flat: z.boolean().nullable(),
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Niste prijavljeni." };

  const { data: activeGoal } = await supabase
    .from("tj_focus_goals")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  const warnNoFocusGoal =
    parsed.data.day_grade != null && !activeGoal ? true : undefined;

  const row = {
    user_id: user.id,
    report_date: reportDate,
    ...parsed.data,
    macro_note: emptyToNull(parsed.data.macro_note),
    mental_rehearsal: emptyToNull(parsed.data.mental_rehearsal),
    impulse_note: emptyToNull(parsed.data.impulse_note),
    rule_broken_note: emptyToNull(parsed.data.rule_broken_note),
    learned_today: emptyToNull(parsed.data.learned_today),
    tomorrow_change: emptyToNull(parsed.data.tomorrow_change),
    easiest_setup: emptyToNull(parsed.data.easiest_setup),
    day_overview: emptyToNull(parsed.data.day_overview),
    celebrate_win: emptyToNull(parsed.data.celebrate_win),
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

function emptyToNull(s: string | null): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

export async function saveFocusGoal(
  goalText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = goalText.trim();
  if (!text) return { ok: false, error: "Cilj fokusa ne može biti prazan." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Niste prijavljeni." };

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

  if (!current) return { ok: false, error: "Nema aktivnog cilja fokusa." };

  const { error } = await supabase
    .from("tj_focus_goals")
    .update({ is_active: false, ended_at: today })
    .eq("id", current.id);
  if (error) return { ok: false, error: error.message };

  revalidateDaily();
  return { ok: true };
}
