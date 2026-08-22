import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

/**
 * Refreshes the Supabase auth session on every request and guards routes.
 * Unauthenticated users are redirected to /login (except for public paths).
 *
 * The check is `getClaims()`, not `getUser()`, and that is the single biggest
 * latency decision in the app. This runs on EVERY request the matcher lets
 * through — every navigation, every server action, and every RSC prefetch Next
 * fires when a sidebar link is hovered. `getUser()` made each of those a round
 * trip to Supabase's auth server: measured at 150–250 ms, before Next had even
 * begun to render. `getClaims()` verifies the JWT signature against the
 * project's public key locally.
 *
 * Safe because the project signs with an asymmetric key (ES256) — see the long
 * note in `user.ts` for why this is verification rather than a naive decode,
 * and for the one thing it gives up (a token stays valid until it expires).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and the auth call —
  // the cookie plumbing above has to be the last thing that touched the client.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
