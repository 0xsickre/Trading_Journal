import "server-only";
import { cache } from "react";
import { createClient } from "./server";

/**
 * The two things the app actually asks about the signed-in user.
 *
 * Deliberately NOT Supabase's `User`. Every call site reads `id` (23 of them,
 * to scope a row by `user_id`) or `email` (one, the sidebar). Returning the
 * full object would have implied the rest of it was available, and the rest of
 * it is exactly what costs a network round trip to fetch.
 */
export type CurrentUser = { id: string; email: string | null };

/**
 * Current authenticated user, verified LOCALLY.
 *
 * `getClaims()` and not `getUser()`. The difference is a network round trip:
 * `getUser()` asks Supabase's auth server to resolve the token on every call,
 * which measured 150–250 ms from here and was paid twice per navigation — once
 * in `proxy.ts` and again in the app layout — before a single data query
 * started. `getClaims()` verifies the JWT signature against the project's
 * public key, in process.
 *
 * This is safe because the project uses ASYMMETRIC signing keys (ES256; the
 * JWKS endpoint serves the public half). Verification is cryptographic, not a
 * decode — an attacker cannot forge a token without the private key, which
 * never leaves Supabase. `getSession()` would have been the unsafe shortcut;
 * this is not that. If the project were ever switched back to a symmetric
 * secret, `getClaims()` silently falls back to a server call, so this stays
 * correct either way — just slower.
 *
 * THE TRADE, stated plainly: claims are trusted until the token expires
 * (1 hour by default). A user deleted or banned server-side keeps a working
 * session until then, where `getUser()` would have locked them out on the next
 * request. For a single-trader journal that is not a threat worth 300 ms per
 * navigation.
 *
 * Still memoized per request (React `cache`) so several server components in
 * one render share the verification instead of each redoing it.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
});
