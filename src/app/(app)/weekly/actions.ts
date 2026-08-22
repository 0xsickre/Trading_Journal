"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { todayInTz } from "@/lib/journal/daily-report";
import { DEFAULT_TZ } from "@/lib/journal/time";
import {
  weekStartOfDayKey,
} from "@/lib/journal/weekly-review";

const weeklyReviewSchema = z.object({
  week_grade: z.number().int().min(1).max(5).nullable(),
  went_well: z.string().nullable(),
  went_badly: z.string().nullable(),
  one_pattern: z.string().nullable(),
  one_change: z.string().nullable(),
  next_week_catalysts: z.string().nullable(),
});

export type SaveWeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;

type Result = { ok: true } | { ok: false; error: string };

function emptyToNull(s: string | null): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

/**
 * Rejects anything that is not a Monday.
 *
 * The DB carries the same CHECK, and this is the copy that produces a sentence
 * instead of a constraint violation. Both are needed: without the CHECK a
 * direct PostgREST write stores Wednesday and the week then exists twice under
 * two keys, with the unique constraint powerless to notice.
 */
function invalidWeek(weekStart: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return "Neispravna nedelja.";
  if (weekStartOfDayKey(weekStart) !== weekStart)
    return "Nedelja počinje ponedeljkom.";
  return null;
}

export async function saveWeeklyReview(
  weekStart: string,
  input: SaveWeeklyReviewInput,
): Promise<{ ok: true; updated_at: string } | { ok: false; error: string }> {
  const bad = invalidWeek(weekStart);
  if (bad) return { ok: false, error: bad };

  const parsed = weeklyReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  // Checked so the user reads this sentence rather than the trigger's. The
  // trigger stays the real guard — PostgREST with the user's JWT is a live
  // write path, so a check here alone is a lock you can walk around.
  const { data: existing } = await supabase
    .from("tj_weekly_reviews")
    .select("locked_at")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing?.locked_at != null)
    return { ok: false, error: "Ova nedelja je zaključana i više se ne menja." };

  const { data, error } = await supabase
    .from("tj_weekly_reviews")
    .upsert(
      {
        user_id: user.id,
        week_start: weekStart,
        week_grade: parsed.data.week_grade,
        went_well: emptyToNull(parsed.data.went_well),
        went_badly: emptyToNull(parsed.data.went_badly),
        one_pattern: emptyToNull(parsed.data.one_pattern),
        one_change: emptyToNull(parsed.data.one_change),
        next_week_catalysts: emptyToNull(parsed.data.next_week_catalysts),
      },
      { onConflict: "user_id,week_start" },
    )
    .select("updated_at")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/weekly");
  return { ok: true, updated_at: data.updated_at };
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
 *
 * A week still running cannot be sealed. Locking Wednesday's view of the week
 * would make the seal a lie: the review would be permanent and the week it
 * describes would not be over.
 */
export async function lockWeek(weekStart: string): Promise<Result> {
  const bad = invalidWeek(weekStart);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nisi prijavljen." };

  const account = await getPrimaryAccount();
  const today = todayInTz(account?.timezone ?? DEFAULT_TZ);
  if (weekStartOfDayKey(today) === weekStart)
    return { ok: false, error: "Ova nedelja još nije završena." };
  if (weekStart > today)
    return { ok: false, error: "Ta nedelja još nije počela." };

  const { data: existing } = await supabase
    .from("tj_weekly_reviews")
    .select("id, locked_at")
    .eq("week_start", weekStart)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Sačuvaj osvrt pre zaključavanja." };
  if (existing.locked_at != null)
    return { ok: false, error: "Ova nedelja je već zaključana." };

  const { error } = await supabase
    .from("tj_weekly_reviews")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/weekly");
  return { ok: true };
}
