import "server-only";
import { createClient } from "@/lib/supabase/server";

export type UserPrefs = {
  /** Journal grid columns switched off. Empty means the default — all visible. */
  journalHiddenColumns: string[];
  /**
   * Dashboard sections switched off. Empty means the default — all visible.
   *
   * Same direction as the columns above and for the same reason: a widget added
   * in a later release is absent from every stored preference, and absent has
   * to mean "shown".
   */
  dashboardHiddenWidgets: string[];
  /**
   * Dashboard sections top to bottom.
   *
   * EMPTY MEANS THE REGISTRY ORDER, not "no sections" — it is what every
   * account starts with and what most keep. `resolveOrder` turns it into a
   * full sequence.
   */
  dashboardWidgetOrder: string[];
  /**
   * Which saved arrangement the live layout above came from, if any.
   *
   * PROVENANCE, NOT INSTRUCTION. The page renders from the two arrays; this
   * only says which template they were last loaded from, so the UI can tell
   * "still matches" from "modified since". Null is the normal state.
   */
  dashboardTemplateId: string | null;
  /**
   * Playbook ids collapsed on /playbooks. Empty means every playbook is
   * expanded — the state every account starts in, and the state a playbook
   * created after this shipped is in until the trader touches it.
   */
  playbooksCollapsed: string[];
};

const EMPTY_PREFS: UserPrefs = {
  journalHiddenColumns: [],
  dashboardHiddenWidgets: [],
  dashboardWidgetOrder: [],
  dashboardTemplateId: null,
  playbooksCollapsed: [],
};

/** A stored array survives only if it is genuinely an array of strings. */
function stringArray(v: unknown): string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : [];
}

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
    .select(
      "journal_hidden_columns, dashboard_hidden_widgets, dashboard_widget_order, dashboard_template_id, playbooks_collapsed",
    )
    .maybeSingle();

  if (!data) return EMPTY_PREFS;
  return {
    journalHiddenColumns: stringArray(data.journal_hidden_columns),
    dashboardHiddenWidgets: stringArray(data.dashboard_hidden_widgets),
    dashboardWidgetOrder: stringArray(data.dashboard_widget_order),
    dashboardTemplateId:
      typeof data.dashboard_template_id === "string"
        ? data.dashboard_template_id
        : null,
    playbooksCollapsed: stringArray(data.playbooks_collapsed),
  };
}
