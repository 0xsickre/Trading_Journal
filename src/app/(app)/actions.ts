"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Widget ids the user has switched off on the dashboard.
 *
 * NOT validated against the registry, and deliberately — the same call
 * `setJournalHiddenColumns` makes about column ids. The list lives in
 * `lib/journal/dashboard-widgets.ts` and changes with the page; a server-side
 * allowlist would have to be edited in lockstep with every widget added, and
 * would reject a preference written by a NEWER client than the one running the
 * action. An id matching nothing is inert on the way out — `visibleWidgets`
 * ignores it — so size and shape are the only real risks, which is what this
 * bounds.
 *
 * The locked widgets are not defended here either, for the same reason they are
 * defended in `visibleWidgets` instead: a rule enforced on the READ path holds
 * against every stored value, including rows written before the rule existed.
 * Enforcing it here as well would only make a malformed row unwritable, not
 * unreadable.
 */
const schema = z.array(z.string().min(1).max(64)).max(100);

export async function setDashboardHiddenWidgets(
  ids: string[],
): Promise<Result> {
  const parsed = schema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid section selection." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Deduped so a double toggle cannot grow the array without bound, and the
  // stored value stays comparable to what the client computed.
  const hidden = [...new Set(parsed.data)];

  const { error } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, dashboard_hidden_widgets: hidden },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}
