"use server";

import { revalidatePath } from "next/cache";
import { revalidateDaily } from "@/lib/journal/revalidate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { DEFAULT_TZ, accountDayZone, dayKeyIn, todayIn } from "@/lib/journal/time";
import { trackerRuleMayHardDelete } from "@/lib/journal/settings-rules";
import { TRACKER_STAGES, type TrackerStage } from "@/lib/journal/tracker-types";

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/daily");
  revalidateDaily();
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Normalize `active_days`.
 *
 * ISO 1-7, deduped and sorted. Duplicates are harmless to `.includes()` but a
 * stored `[1,1,1]` reads as a bug to the next person, and the DB CHECK bounds
 * the length. An empty selection is rejected rather than silently meaning
 * "never": a rule that applies on no day is a rule you meant to retire.
 */
function normalizeDays(days: number[] | undefined): number[] | null {
  if (!days) return null;
  const clean = [...new Set(days.map(Number))]
    // Weekdays only: the weekend is never scored (`ruleIsLiveOn`), so storing
    // Saturday or Sunday would only be a day the picker cannot show.
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 5)
    .sort((a, b) => a - b);
  return clean.length > 0 ? clean : null;
}

export async function addTrackerRule(input: {
  text: string;
  stage: TrackerStage;
  active_days?: number[];
}): Promise<Result> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "The rule cannot be empty." };
  if (!TRACKER_STAGES.includes(input.stage))
    return { ok: false, error: "Unknown stage." };

  const days = normalizeDays(input.active_days ?? [1, 2, 3, 4, 5]);
  if (!days) return { ok: false, error: "Pick at least one day." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_tracker_rules")
    .select("sort_order")
    .eq("stage", input.stage)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  // User rules are never mandatory and never automatic. Both are properties of
  // the seeded set: `auto_key` needs an evaluator that exists in code, and
  // `is_mandatory` only guards deletion of those seeded rules.
  const { error } = await supabase.from("tj_tracker_rules").insert({
    user_id: user.id,
    text,
    stage: input.stage,
    active_days: days,
    auto_key: null,
    config: {},
    is_mandatory: false,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Edit a rule.
 *
 * `auto_key` is deliberately absent from the patch: it decides which evaluator
 * runs, so changing it would silently re-interpret every check-in already
 * recorded against the rule. Retire the rule and write a new one instead —
 * that keeps the old statistics attached to the question they answered.
 */
export async function updateTrackerRule(
  id: string,
  patch: {
    text?: string;
    stage?: TrackerStage;
    active_days?: number[];
  },
): Promise<Result> {
  const next: {
    text?: string;
    stage?: string;
    active_days?: number[];
  } = {};

  if (patch.text != null) {
    const text = patch.text.trim();
    if (!text) return { ok: false, error: "The rule cannot be empty." };
    next.text = text;
  }
  if (patch.stage != null) {
    if (!TRACKER_STAGES.includes(patch.stage))
      return { ok: false, error: "Unknown stage." };
    next.stage = patch.stage;
  }
  if (patch.active_days != null) {
    const days = normalizeDays(patch.active_days);
    if (!days) return { ok: false, error: "Pick at least one day." };
    next.active_days = days;
  }

  if (Object.keys(next).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("tj_tracker_rules").update(next).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Retire a rule.
 *
 * Deleted outright only when it was created TODAY and never answered. Any older
 * rule was live on past days — as an unanswered box it already counted against
 * them — so a hard delete would take it out of those days' denominators and
 * raise their scores after the fact. `compliance.ts` reads `deleted_at` as the
 * cutoff, which is exactly what keeps history still. It used to hard-delete
 * every non-mandatory rule that had never been answered, however old.
 */
export async function deleteTrackerRule(id: string): Promise<Result> {
  const supabase = await createClient();

  const [{ data: rule, error: ruleError }, { count, error: countError }, account] =
    await Promise.all([
      supabase
        .from("tj_tracker_rules")
        .select("is_mandatory, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("tj_tracker_checkins")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", id),
      getPrimaryAccount(),
    ]);
  if (ruleError) return { ok: false, error: ruleError.message };
  if (!rule) return { ok: false, error: "Rule not found." };
  // A failed count must not read as "never answered": that is the branch that
  // deletes.
  if (countError)
    return { ok: false, error: "Could not check whether this rule was answered, so it was not changed. Try again." };

  // One day rule for both, the primary account's: "created today" and "today"
  // must be the same day, on a Topstep account too.
  const zone = account ? accountDayZone(account) : DEFAULT_TZ;
  const hardDelete = trackerRuleMayHardDelete({
    createdDay: dayKeyIn(rule.created_at, zone),
    today: todayIn(zone),
    answered: (count ?? 0) > 0,
    mandatory: rule.is_mandatory,
  });

  const { data: changed, error } = hardDelete
    ? await supabase.from("tj_tracker_rules").delete().eq("id", id).select("id")
    : await supabase
        .from("tj_tracker_rules")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");

  if (error) return { ok: false, error: error.message };
  if (!changed || changed.length === 0) return { ok: false, error: "Rule not found." };
  revalidateAll();
  return { ok: true };
}

/**
 * Bring a retired rule back.
 *
 * The gap stays a gap: days between retirement and restoration were genuinely
 * not tracked by this rule, and `compliance.ts` reads `deleted_at` as a single
 * cutoff. Clearing it makes the rule applicable to those days retroactively,
 * which is why the UI says so before doing it.
 */
export async function restoreTrackerRule(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_tracker_rules")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function moveTrackerRule(
  id: string,
  direction: -1 | 1,
): Promise<Result> {
  const supabase = await createClient();
  const { data: self } = await supabase
    .from("tj_tracker_rules")
    .select("id, stage")
    .eq("id", id)
    .maybeSingle();
  if (!self) return { ok: false, error: "Rule not found." };

  const { data: siblings } = await supabase
    .from("tj_tracker_rules")
    .select("id")
    .eq("stage", self.stage)
    .is("deleted_at", null)
    .order("sort_order")
    .order("id");
  if (!siblings) return { ok: false, error: "Read failed." };

  const i = siblings.findIndex((s) => s.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= siblings.length) return { ok: true };

  // Rewrite the whole stage's ordinals from the reordered array. Swapping two
  // sort_order values instead deadlocks whenever rows already share one.
  const reordered = [...siblings];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  for (const [ord, row] of reordered.entries()) {
    const { error } = await supabase
      .from("tj_tracker_rules")
      .update({ sort_order: ord })
      .eq("id", row.id);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}
