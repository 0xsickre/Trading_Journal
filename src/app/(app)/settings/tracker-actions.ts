"use server";

import { revalidatePath } from "next/cache";
import { revalidateDaily } from "@/lib/journal/revalidate";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getCurrentUser } from "@/lib/supabase/user";
import {
  AUTO_RULES_NEEDING_PCT,
  TRACKER_STAGES,
  type AutoRuleKey,
  type TrackerStage,
} from "@/lib/journal/tracker-types";

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/daily");
  revalidateDaily();
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Config schema per `auto_key`.
 *
 * `.strict()` on purpose: a future `{"basis":"pct"}` must fail loudly until an
 * evaluator knows what to do with it, rather than being stored and silently
 * ignored. A manual rule has nothing to configure at all, which the DB also
 * enforces.
 */
/**
 * Capped at 100: a limit of "lose more than all of it" is not a limit, and a
 * stray keypress turning 2 into 200 would silently switch the rule off rather
 * than tighten it.
 */
const pctConfig = z
  .object({ pct: z.number().finite().positive().max(100).optional() })
  .strict();
const emptyConfig = z.object({}).strict();

function configSchema(autoKey: AutoRuleKey | null) {
  if (autoKey == null) return emptyConfig;
  return AUTO_RULES_NEEDING_PCT.has(autoKey) ? pctConfig : emptyConfig;
}

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
    config?: Record<string, unknown>;
  },
): Promise<Result> {
  const next: {
    text?: string;
    stage?: string;
    active_days?: number[];
    // `Json` rather than a plain record: the zod schema has already narrowed
    // this to a validated shape, and PostgREST serializes it as jsonb.
    config?: Json;
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

  const supabase = await createClient();

  if (patch.config != null) {
    // The schema depends on which evaluator the rule runs, so the rule has to be
    // read before its config can be validated.
    const { data: current } = await supabase
      .from("tj_tracker_rules")
      .select("auto_key")
      .eq("id", id)
      .maybeSingle();
    if (!current) return { ok: false, error: "Rule not found." };

    const parsed = configSchema(
      (current.auto_key as AutoRuleKey | null) ?? null,
    ).safeParse(patch.config);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          current.auto_key == null
            ? "A manual rule has nothing to configure."
            : "The limit must be a positive number.",
      };
    }
    next.config = parsed.data;
  }

  if (Object.keys(next).length === 0) return { ok: true };

  const { error } = await supabase.from("tj_tracker_rules").update(next).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Clear a money limit, which puts the rule back to "not applicable". */
export async function clearTrackerRuleLimit(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_tracker_rules")
    .update({ config: {} })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Retire a rule.
 *
 * Soft once it has been answered, hard when it never was — the same shape as
 * `deletePlaybookRule`. The soft path is not politeness: `compliance.ts` decides
 * applicability by comparing each day against `deleted_at`, so a hard delete
 * would erase the denominator of every past day the rule was live on and
 * silently raise those scores.
 *
 * Mandatory rules can be retired like any other; `is_mandatory` guards the hard
 * delete and the identity of the seeded set, not the user's right to stop
 * tracking something.
 */
export async function deleteTrackerRule(id: string): Promise<Result> {
  const supabase = await createClient();

  const [{ data: rule }, { count }] = await Promise.all([
    supabase.from("tj_tracker_rules").select("is_mandatory").eq("id", id).maybeSingle(),
    supabase
      .from("tj_tracker_checkins")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", id),
  ]);
  if (!rule) return { ok: false, error: "Rule not found." };

  const answered = (count ?? 0) > 0;
  if (rule.is_mandatory && !answered) {
    // Nothing to preserve, but hard-deleting a seeded rule would let it come
    // back on the next reseed and look like it was never removed.
    const { error } = await supabase
      .from("tj_tracker_rules")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  }

  const { error } = answered
    ? await supabase
        .from("tj_tracker_rules")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
    : await supabase.from("tj_tracker_rules").delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
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
