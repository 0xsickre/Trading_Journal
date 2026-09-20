"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { todayInTz } from "@/lib/journal/daily-report";
import { revalidateWeekly } from "@/lib/journal/revalidate";
import { DEFAULT_TZ } from "@/lib/journal/time";
import {
  PREVIOUS_CHANGE_KEPT,
  weekLockRefusal,
  weekSaveRefusal,
} from "@/lib/journal/weekly-review";

/**
 * A cap on the five prose fields.
 *
 * The columns are unbounded `text` and the schema had no limit, so a pasted
 * chat log went straight in and came back on every page load of the week.
 * 4,000 characters is far above any answer anyone writes by hand and far below
 * anything worth storing here; the save is refused rather than truncated,
 * because silently cutting a trader's own words is worse than saying no.
 */
const MAX_ANSWER = 4000;

const answer = (label: string) =>
  z.string().max(MAX_ANSWER, `${label}: najviše ${MAX_ANSWER} znakova.`).nullable();

const weeklyReviewSchema = z.object({
  week_grade: z.number().int().min(1).max(5).nullable(),
  went_well: answer("Šta je išlo dobro"),
  went_badly: answer("Šta je išlo loše"),
  one_pattern: answer("Jedan obrazac"),
  one_change: answer("Jedna stvar koju menjam"),
  next_week_catalysts: answer("Kalendar sledeće nedelje"),
  /**
   * The answer to last week's commitment, written on THIS week's row: it is a
   * judgement made now, about a week that may already be sealed.
   */
  previous_change_kept: z.enum(PREVIOUS_CHANGE_KEPT).nullable().optional(),
});

export type SaveWeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;

type Result = { ok: true } | { ok: false; error: string };

function emptyToNull(s: string | null): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

/** True when PostgREST says the column is not there — the migration is not applied yet. */
function missingColumn(error: { code?: string; message: string } | null): boolean {
  return (
    error != null &&
    (error.code === "PGRST204" ||
      /column .*previous_change_kept.* does not exist/i.test(error.message) ||
      /could not find the 'previous_change_kept' column/i.test(error.message))
  );
}

/** Today in the account's zone — the clock every refusal below is measured against. */
async function todayKey(): Promise<string> {
  const account = await getPrimaryAccount();
  return todayInTz(account?.timezone ?? DEFAULT_TZ);
}

export async function saveWeeklyReview(
  weekStart: string,
  input: SaveWeeklyReviewInput,
): Promise<{ ok: true; updated_at: string } | { ok: false; error: string }> {
  const parsed = weeklyReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  // The lock is read before the write so the user gets this sentence rather
  // than the trigger's. The trigger stays the real guard — PostgREST with the
  // user's JWT is a live write path, so a check here alone is a lock you can
  // walk around.
  const { data: existing } = await supabase
    .from("tj_weekly_reviews")
    .select("locked_at")
    .eq("week_start", weekStart)
    .maybeSingle();

  const refusal = weekSaveRefusal({
    weekStart,
    todayKey: await todayKey(),
    lockedAt: existing?.locked_at ?? null,
  });
  if (refusal) return { ok: false, error: refusal };

  const row = {
    user_id: user.id,
    week_start: weekStart,
    week_grade: parsed.data.week_grade,
    went_well: emptyToNull(parsed.data.went_well),
    went_badly: emptyToNull(parsed.data.went_badly),
    one_pattern: emptyToNull(parsed.data.one_pattern),
    one_change: emptyToNull(parsed.data.one_change),
    next_week_catalysts: emptyToNull(parsed.data.next_week_catalysts),
  };

  const save = (extra: Record<string, unknown>) =>
    supabase
      .from("tj_weekly_reviews")
      .upsert({ ...row, ...extra }, { onConflict: "user_id,week_start" })
      .select("updated_at")
      .single();

  let { data, error } = await save(
    parsed.data.previous_change_kept !== undefined
      ? { previous_change_kept: parsed.data.previous_change_kept }
      : {},
  );

  // Until the migration is applied the column is not there. The five answers
  // are worth more than the follow-up flag, so the review is saved without it
  // rather than refused — the same fallback the Settings actions use for an
  // RPC that has not shipped yet.
  if (error && missingColumn(error)) ({ data, error } = await save({}));

  if (error) return { ok: false, error: error.message };

  revalidateWeekly();
  return { ok: true, updated_at: data!.updated_at };
}

/**
 * Seal the week. Irreversible — unlocking is an UPDATE, and the trigger refuses
 * every update of a locked row.
 *
 * Unlike `tj_lock_day` this is a plain update rather than an RPC, because there
 * is nothing to FREEZE. The day's lock exists to snapshot automatic verdicts
 * before a later trade edit can move them; a weekly review is entirely
 * hand-written, so there is no derived value here to pin — only writes to
 * refuse afterwards.
 */
export async function lockWeek(weekStart: string): Promise<Result> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  const { data: existing } = await supabase
    .from("tj_weekly_reviews")
    .select("id, locked_at")
    .eq("week_start", weekStart)
    .maybeSingle();

  const refusal = weekLockRefusal({
    weekStart,
    todayKey: await todayKey(),
    existing: existing ?? null,
  });
  if (refusal) return { ok: false, error: refusal };

  const { error } = await supabase
    .from("tj_weekly_reviews")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", existing!.id);
  if (error) return { ok: false, error: error.message };

  revalidateWeekly();
  return { ok: true };
}
