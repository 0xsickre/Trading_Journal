"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import {
  TEMPLATE_NAME_MAX,
  normalizeTemplateName,
} from "@/lib/journal/dashboard-templates";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Widget ids the user has switched off on the dashboard.
 *
 * NOT validated against the registry, and deliberately — the same call
 * `setJournalHiddenColumns` makes about column ids. The list lives in
 * `lib/journal/dashboard-widgets.ts` and changes with the page; a server-side
 * allowlist would have to be edited in lockstep with every widget added, and
 * would reject a preference written by a NEWER client than the one running the
 * action. An id matching nothing is inert on the way out — `visibleWidgets`
 * ignores it — so size and shape are the only real risks, which is what this
 * bounds.
 *
 * The locked widgets are not defended here either, for the same reason they are
 * defended in `visibleWidgets` instead: a rule enforced on the READ path holds
 * against every stored value, including rows written before the rule existed.
 * Enforcing it here as well would only make a malformed row unwritable, not
 * unreadable.
 */
const schema = z.array(z.string().min(1).max(64)).max(100);

export async function setDashboardHiddenWidgets(
  ids: string[],
): Promise<Result> {
  const parsed = schema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid section selection." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Deduped so a double toggle cannot grow the array without bound, and the
  // stored value stays comparable to what the client computed.
  const hidden = [...new Set(parsed.data)];

  const { error } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, dashboard_hidden_widgets: hidden },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * The order the dashboard's sections render in, top to bottom.
 *
 * Stored as the WHOLE sequence rather than as a moved id and a direction. The
 * client already computes the full canonical order — `moveWidget` materializes
 * it precisely so a move can be expressed against an empty stored value — and
 * having the server recompute it from a delta would be two implementations of
 * one rule, drifting the first time the registry changes.
 *
 * Deduped for the same reason the hidden set is: a duplicated id would render
 * one section twice, and `resolveOrder` already refuses that on the way out.
 * Doing it here too keeps the stored value equal to what the client believes it
 * wrote.
 */
export async function setDashboardWidgetOrder(ids: string[]): Promise<Result> {
  const parsed = schema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid section order." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const order = [...new Set(parsed.data)];

  const { error } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, dashboard_widget_order: order },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/* Saved arrangements ------------------------------------------------------ */

const nameSchema = z.string().min(1).max(TEMPLATE_NAME_MAX);
const idSchema = z.string().uuid();

/** Postgres speaks in codes; the reader gets the one sentence that helps. */
function templateError(code: string | undefined, fallback: string): string {
  return code === "23505"
    ? "A saved layout with that name already exists."
    : fallback;
}

export async function createDashboardTemplate(
  rawName: string,
  widgets: string[],
): Promise<Result> {
  const name = normalizeTemplateName(rawName);
  if (!name || !nameSchema.safeParse(name).success) {
    return { ok: false, error: "Give the layout a name." };
  }
  const parsed = schema.safeParse(widgets);
  // The column refuses an empty array too — a saved layout with no sections is
  // a blank page wearing a name.
  if (!parsed.success || parsed.data.length === 0) {
    return { ok: false, error: "A layout needs at least one section." };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("tj_dashboard_templates")
    .insert({ user_id: user.id, name, widgets: [...new Set(parsed.data)] })
    .select("id")
    .single();
  if (error) return { ok: false, error: templateError(error.code, error.message) };

  // Selected on creation. Saving an arrangement and then not being on it is a
  // surprise; the reader just said this is the one they want.
  const { error: selErr } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, dashboard_template_id: data.id },
    { onConflict: "user_id" },
  );
  if (selErr) return { ok: false, error: selErr.message };

  revalidatePath("/");
  return { ok: true };
}

export async function renameDashboardTemplate(
  id: string,
  rawName: string,
): Promise<Result> {
  const name = normalizeTemplateName(rawName);
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Unknown layout." };
  if (!name) return { ok: false, error: "Give the layout a name." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_dashboard_templates")
    .update({ name })
    .eq("id", id);
  if (error) return { ok: false, error: templateError(error.code, error.message) };

  revalidatePath("/");
  return { ok: true };
}

/** Overwrite a saved arrangement with whatever is on screen now. */
export async function updateDashboardTemplateWidgets(
  id: string,
  widgets: string[],
): Promise<Result> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Unknown layout." };
  const parsed = schema.safeParse(widgets);
  if (!parsed.success || parsed.data.length === 0) {
    return { ok: false, error: "A layout needs at least one section." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_dashboard_templates")
    .update({ widgets: [...new Set(parsed.data)] })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

export async function deleteDashboardTemplate(id: string): Promise<Result> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Unknown layout." };

  const supabase = await createClient();
  // `dashboard_template_id` is ON DELETE SET NULL, so the selection clears
  // itself and the live layout — which is what the page renders from — is
  // untouched. The reader keeps the arrangement on screen and loses only its
  // name, which is the least surprising thing deletion can do.
  const { error } = await supabase
    .from("tj_dashboard_templates")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Load a saved arrangement, or go back to an ad-hoc one.
 *
 * Writes the live layout AND the provenance in one call, because a selection
 * that set only the id would leave the page showing something the template does
 * not describe while claiming to be on it.
 */
export async function selectDashboardTemplate(
  id: string | null,
  hidden: string[],
  order: string[],
): Promise<Result> {
  if (id !== null && !idSchema.safeParse(id).success) {
    return { ok: false, error: "Unknown layout." };
  }
  const h = schema.safeParse(hidden);
  const o = schema.safeParse(order);
  if (!h.success || !o.success) return { ok: false, error: "Invalid layout." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("tj_user_prefs").upsert(
    {
      user_id: user.id,
      dashboard_template_id: id,
      dashboard_hidden_widgets: [...new Set(h.data)],
      dashboard_widget_order: [...new Set(o.data)],
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}
