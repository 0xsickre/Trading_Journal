import "server-only";
import { createClient } from "@/lib/supabase/server";

export type UserPrefs = {
  /** Journal grid columns switched off. Empty means the default — all visible. */
  journalHiddenColumns: string[];
};

const EMPTY_PREFS: UserPrefs = { journalHiddenColumns: [] };

/**
 * The signed-in user's UI preferences.
 *
 * A missing row is the normal state, not an error: the row is written the first
 * time a preference is actually changed, so most users never have one. Defaults
 * come back instead, and the caller cannot tell the difference — which is the
 * point.
 */
export async function getUserPrefs(): Promise<UserPrefs> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_user_prefs")
    .select("journal_hidden_columns")
    .maybeSingle();

  if (!data) return EMPTY_PREFS;
  return {
    journalHiddenColumns: Array.isArray(data.journal_hidden_columns)
      ? data.journal_hidden_columns
      : [],
  };
}
