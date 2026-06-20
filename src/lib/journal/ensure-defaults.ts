import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Idempotent fallback seeding. New users are seeded at signup by the DB trigger
 * `tj_on_auth_user_created` → `tj_seed_defaults()`. This RPC (`tj_seed_my_defaults`)
 * re-runs the same SQL for the current user and is a no-op once data exists — it
 * covers users created before the trigger and any (caught) trigger failure.
 */
export async function ensureDefaults() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.rpc("tj_seed_my_defaults");
  if (error) console.error("ensureDefaults (tj_seed_my_defaults) failed", error);
}
