"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Column ids the user has switched off.
 *
 * Ids are not validated against a list of known columns, deliberately: the list
 * lives in the grid component and changes with it, and a server-side allowlist
 * would have to be edited in lockstep with every column added. An id that
 * matches nothing is inert — `hiddenToVisibility` ignores it — so the only real
 * risks are size and shape, which is what this bounds.
 */
const schema = z.array(z.string().min(1).max(64)).max(100);

export async function setJournalHiddenColumns(ids: string[]): Promise<Result> {
  const parsed = schema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Neispravan izbor kolona." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Deduped so a double toggle cannot grow the array without bound, and the
  // stored value stays comparable to what the client computed.
  const hidden = [...new Set(parsed.data)];

  const { error } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, journal_hidden_columns: hidden },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/journal");
  return { ok: true };
}
