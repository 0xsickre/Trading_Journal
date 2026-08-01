"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getCurrentUser } from "@/lib/supabase/user";
import { getAccounts, getPrimaryAccount } from "@/lib/journal/accounts";
import { todayInTz } from "@/lib/journal/daily-report";
import { DEFAULT_TZ } from "@/lib/journal/time";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getTrackerRules } from "@/lib/journal/tracker/queries";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
} from "@/lib/journal/tracker/auto-rules";
import {
  freezeAutoCheckins,
  ruleIsLiveOn,
} from "@/lib/journal/tracker/compliance";

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

  revalidatePath("/daily");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Seal a day's process journal.
 *
 * Irreversible by design, and enforced in the database rather than here: a
 * trigger raises on ANY update of a locked report row, and unlocking would be an
 * update. There is no unlock action to write.
 *
 * What it does NOT touch is the trades. P&L is a fact that has to stay
 * correctable — a mistyped fill from a locked day must be fixable, and every
 * money figure must move when it is. Compliance does not move with it, because
 * the auto verdicts are frozen into rows right here, and `resolveAutoResults`
 * reads those back in preference to a fresh evaluation.
 *
 * The verdicts are computed in TypeScript and handed to the RPC. Re-deriving the
 * open-day/close-day attribution in SQL would create a second source of truth for
 * the one rule in this phase most easily got wrong.
 */
export async function lockDay(reportDate: string): Promise<Result> {
  if (!DAY_RE.test(reportDate)) return { ok: false, error: "Neispravan datum." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const [accounts, rules, trades] = await Promise.all([
    getAccounts(),
    getTrackerRules({ includeRetired: true }),
    getTradesWithStats(),
  ]);

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const timezone = primary?.timezone ?? DEFAULT_TZ;
  if (reportDate > todayInTz(timezone))
    return { ok: false, error: "Budući dan se ne može zaključati." };

  const index = buildTradeDayIndex(
    trades,
    (row) => accounts.find((a) => a.id === row.account_id)?.timezone ?? timezone,
  );
  const auto = evaluateAutoRulesForDay(
    reportDate,
    index,
    configsFromRules(rules),
  );

  // Only rules live on THIS day get frozen. Freezing a rule that did not run on
  // this weekday would invent an answer for a question never asked.
  const live = rules.filter((r) => ruleIsLiveOn(r, reportDate));

  const { error } = await supabase.rpc("tj_lock_day", {
    p_date: reportDate,
    // `Json` because the RPC takes jsonb; the shape is fixed by freezeAutoCheckins.
    p_auto: freezeAutoCheckins(live, auto) as unknown as Json,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/daily");
  revalidatePath("/");
  return { ok: true };
}
