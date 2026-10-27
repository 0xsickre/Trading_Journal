import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "./types";

/**
 * The Supabase client for this request, as the signed-in user (RLS applies).
 *
 * A request with `Authorization: Bearer <access token>` is a machine caller —
 * the NinjaTrader sync on the trader's PC (phase I3) — and runs as the user that
 * token belongs to, with no cookies. A browser never sends that header, so every
 * page and server action keeps its cookie session unchanged.
 */
export async function createClient() {
  const bearer = (await headers()).get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: bearer } },
      },
    );
  }
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore when middleware
            // is refreshing sessions.
          }
        },
      },
    },
  );
}
