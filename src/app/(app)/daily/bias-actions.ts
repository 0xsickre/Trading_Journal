"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { BIAS_ROOTS } from "@/lib/journal/default-instruments";
import { BIAS_DIRS } from "@/lib/journal/daily-bias";
import { isValidDayKey, todayFor } from "@/lib/journal/time";

const schema = z.object({
  root: z.enum(BIAS_ROOTS),
  bias: z.enum(BIAS_DIRS),
  reason: z.string().trim().max(500, "Razlog je duži od 500 znakova.").optional(),
});

export type AddDailyBiasInput = z.infer<typeof schema>;

/**
 * Bias dana (faza D): one more forecast for the day and root. Insert only — a forecast is never
 * edited; a change is a new row, and the earliest one is what counts. The time it was set is
 * written by the database (`tj_daily_bias_guard`), not taken from here.
 *
 * Only for today: a forecast for a day that has started elsewhere or already ended is a story
 * written with the price in view.
 */
export async function addDailyBias(
  day: string,
  input: AddDailyBiasInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
  if (!isValidDayKey(day)) return { ok: false, error: "Neispravan datum." };
  const account = await getPrimaryAccount();
  if (day !== todayFor(account)) return { ok: false, error: "Bias se upisuje samo za današnji dan." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  const { data: report } = await supabase.from("tj_daily_reports").select("locked_at").eq("report_date", day).maybeSingle();
  if (report?.locked_at != null) return { ok: false, error: "Ovaj dan je zaključan i više se ne menja." };

  const { error } = await supabase.from("tj_daily_bias").insert({
    user_id: user.id,
    trading_day: day,
    root: parsed.data.root,
    bias: parsed.data.bias,
    reason: parsed.data.reason ? parsed.data.reason : null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/daily");
  return { ok: true };
}
