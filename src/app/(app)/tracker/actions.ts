"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { todayInTz } from "@/lib/journal/daily-report";

type Result = { ok: true } | { ok: false; error: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Answer, change or clear one manual rule for one day.
 *
 * `checked: null` means "no answer", and is stored as the ABSENCE of a row, not
 * as a NULL. The distinction is load-bearing in two places:
 *
 *   - `computeDayCompliance` treats a missing row on today as `pending` (the day
 *     is still running) but counts it as missed on a past day. A stored NULL
 *     would be indistinguishable from an answered box in the row count.
 *   - the table's CHECK (`checked IS NOT NULL OR auto_evaluated`) reserves NULL
 *     for frozen auto rows, where it means "evaluated, not applicable".
 *
 * So the three states are: no row, `true`, `false`. An explicit `false` is worth
 * recording — it turns today from `pending` into `broken`, which is the honest
 * answer when you know you skipped something.
 */
export async function setCheckin(
  ruleId: string,
  reportDate: string,
  checked: boolean | null,
): Promise<Result> {
  if (!DAY_RE.test(reportDate)) return { ok: false, error: "Neispravan datum." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const account = await getPrimaryAccount();
  const today = todayInTz(account?.timezone ?? "America/New_York");
  if (reportDate > today)
    return { ok: false, error: "Budući dan još nije počeo." };

  const { data: rule } = await supabase
    .from("tj_tracker_rules")
    .select("id, auto_key, deleted_at")
    .eq("id", ruleId)
    .maybeSingle();
  if (!rule) return { ok: false, error: "Pravilo nije nađeno." };

  // An auto rule is answered by the evaluator, and by tj_lock_day at freeze
  // time. A hand-written row would be ignored by the read path on an unlocked
  // day and then overwritten at lock time — dead data that reads as an answer.
  if (rule.auto_key != null)
    return { ok: false, error: "Automatsko pravilo se ne čekira rukom." };
  if (rule.deleted_at != null)
    return { ok: false, error: "Pravilo je penzionisano." };

  // Checked before writing so the user sees this sentence instead of the
  // trigger's. The trigger stays the actual guard: PostgREST with the user's JWT
  // is a live write path, so a check here alone is a lock you walk around.
  const { data: report } = await supabase
    .from("tj_daily_reports")
    .select("locked_at")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (report?.locked_at != null)
    return { ok: false, error: "Dan je zaključan — čekiranje je zamrznuto." };

  const { error } =
    checked == null
      ? await supabase
          .from("tj_tracker_checkins")
          .delete()
          .eq("rule_id", ruleId)
          .eq("report_date", reportDate)
      : await supabase.from("tj_tracker_checkins").upsert(
          {
            user_id: user.id,
            rule_id: ruleId,
            report_date: reportDate,
            checked,
            auto_evaluated: false,
          },
          { onConflict: "rule_id,report_date" },
        );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tracker");
  revalidatePath("/daily");
  revalidatePath("/");
  return { ok: true };
}
