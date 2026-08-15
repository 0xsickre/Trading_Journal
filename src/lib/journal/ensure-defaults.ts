import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";

/**
 * Idempotent fallback seeding. New users are seeded at signup by the DB trigger
 * `tj_on_auth_user_created` → `tj_seed_defaults()`. This RPC (`tj_seed_my_defaults`)
 * re-runs the same SQL for the current user and is a no-op once data exists — it
 * covers users created before the trigger and any (caught) trigger failure.
 *
 * That second clause was load-bearing for thirteen months and nobody knew. The
 * signup trigger called a function dropped with the analysis module, and because
 * a PL/pgSQL block with an EXCEPTION clause is a subtransaction, the throw rolled
 * back the seeding that had already succeeded beside it. Every user registered
 * after 19 July 2026 was seeded by THIS call and not by the trigger — and only on
 * reaching the home page. See `20260815120000_fix_auth_seed_trigger.sql`.
 *
 * Called from the home page (not the shared layout) so it doesn't add a round-trip
 * to every sub-navigation. That is a deliberate trade, but it is also why the
 * trigger has to work: a user whose first navigation is a bookmarked `/journal`
 * never passes through here.
 */
export async function ensureDefaults() {
  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("tj_seed_my_defaults");
  if (error) console.error("ensureDefaults (tj_seed_my_defaults) failed", error);
}
