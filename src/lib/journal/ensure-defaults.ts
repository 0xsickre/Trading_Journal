import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";

/**
 * Idempotent fallback seeding. New users are seeded at signup by the DB trigger
 * `tj_on_auth_user_created` → `tj_seed_defaults()`. This RPC (`tj_seed_my_defaults`)
 * re-runs the same SQL for the current user and is a no-op once data exists — it
 * covers users created before the trigger and any (caught) trigger failure.
 *
 * Called from the home page (not the shared layout) so it doesn't add a round-trip
 * to every sub-navigation.
 */
export async function ensureDefaults() {
  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("tj_seed_my_defaults");
  if (error) console.error("ensureDefaults (tj_seed_my_defaults) failed", error);
}
