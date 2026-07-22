import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FocusGoal } from "./focus-goal";

export async function getActiveFocusGoal(): Promise<FocusGoal | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_focus_goals")
    .select(
      "id,user_id,goal_text,started_at,is_active,ended_at,created_at,updated_at",
    )
    .eq("is_active", true)
    .maybeSingle();
  return (data as FocusGoal | null) ?? null;
}
