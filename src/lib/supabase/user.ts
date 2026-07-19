import "server-only";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";

/**
 * Current authenticated user, memoized per request (React `cache`), so multiple
 * server components / helpers in one render share a single `auth.getUser()` call
 * instead of each hitting Supabase again.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
