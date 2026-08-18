import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DashboardTemplate } from "./dashboard-templates";

/**
 * The signed-in user's saved dashboard arrangements, newest name order.
 *
 * Sorted by name rather than by creation date: this list is a picker, and a
 * reader looking for "Swing" wants it where the alphabet says, not wherever it
 * happened to be created. RLS restricts the rows; no user filter is needed here
 * and adding one would imply the policy might not hold.
 */
export async function getDashboardTemplates(): Promise<DashboardTemplate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_dashboard_templates")
    .select("id, name, widgets")
    .order("name");

  if (!data) return [];
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    // Defended even though the column is NOT NULL: this array decides what the
    // page shows, and a value that arrived malformed must cost the template
    // rather than the render.
    widgets: Array.isArray(row.widgets)
      ? row.widgets.filter((w): w is string => typeof w === "string")
      : [],
  }));
}
