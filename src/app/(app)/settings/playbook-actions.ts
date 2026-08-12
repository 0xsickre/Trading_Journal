"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { SHOW_WHEN_VALUES, type ShowWhen } from "@/lib/journal/playbook-types";

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/trades/new");
  revalidatePath("/journal");
  revalidatePath("/reports");
  revalidatePath("/", "layout");
}

type Result = { ok: true } | { ok: false; error: string };

// --- Playbooks --------------------------------------------------------------

export async function addPlaybook(name: string): Promise<Result> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "The name cannot be empty." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_playbooks")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: book, error } = await supabase
    .from("tj_playbooks")
    .insert({
      user_id: user.id,
      name: clean,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !book) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "A playbook with that name already exists."
          : (error?.message ?? "Insert failed"),
    };
  }

  // A playbook with no groups has nowhere to put a rule, so the empty state
  // would be a dead end. Same three groups the seed uses.
  const { error: gErr } = await supabase.from("tj_playbook_groups").insert(
    ["Entry", "Exit", "Market conditions"].map((n, i) => ({
      user_id: user.id,
      playbook_id: book.id,
      name: n,
      sort_order: i,
    })),
  );
  if (gErr) return { ok: false, error: gErr.message };

  revalidateAll();
  return { ok: true };
}

export async function updatePlaybook(
  id: string,
  patch: { name?: string; description?: string | null; is_active?: boolean },
): Promise<Result> {
  const next: { name?: string; description?: string | null; is_active?: boolean } = {};
  if (patch.name != null) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "The name cannot be empty." };
    next.name = clean;
  }
  if (patch.description !== undefined)
    next.description = patch.description?.trim() || null;
  if (patch.is_active != null) next.is_active = patch.is_active;
  if (Object.keys(next).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("tj_playbooks").update(next).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Delete a playbook.
 *
 * Refused once trades reference it. `ON DELETE SET NULL` would let the delete
 * succeed and silently strip the strategy off every trade that used it — the
 * history would survive as rows and lose the one field that says what they were.
 */
export async function deletePlaybook(id: string): Promise<Result> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("tj_positions")
    .select("id", { count: "exact", head: true })
    .eq("playbook_id", id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} trejdova koristi ovaj playbook — deaktiviraj ga umesto brisanja.`,
    };
  }

  const { error } = await supabase.from("tj_playbooks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// --- Groups -----------------------------------------------------------------

export async function addPlaybookGroup(
  playbookId: string,
  name: string,
): Promise<Result> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "The group name cannot be empty." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_playbook_groups")
    .select("sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("tj_playbook_groups").insert({
    user_id: user.id,
    playbook_id: playbookId,
    name: clean,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function renamePlaybookGroup(
  id: string,
  name: string,
): Promise<Result> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "The group name cannot be empty." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_playbook_groups")
    .update({ name: clean })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Refused while the group still holds live rules — cascade would take them. */
export async function deletePlaybookGroup(id: string): Promise<Result> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("tj_playbook_rules")
    .select("id", { count: "exact", head: true })
    .eq("group_id", id)
    .is("deleted_at", null);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: "The group still has rules — delete or move them first.",
    };
  }

  const { count: archived } = await supabase
    .from("tj_playbook_rules")
    .select("id", { count: "exact", head: true })
    .eq("group_id", id)
    .not("deleted_at", "is", null);

  if ((archived ?? 0) > 0) {
    return {
      ok: false,
      error:
        "The group holds archived rules whose statistics still sit on old trades — it cannot be deleted.",
    };
  }

  const { error } = await supabase.from("tj_playbook_groups").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// --- Rules ------------------------------------------------------------------

export async function addPlaybookRule(input: {
  group_id: string;
  text: string;
  show_when?: ShowWhen;
}): Promise<Result> {
  const clean = input.text.trim();
  if (!clean) return { ok: false, error: "The rule cannot be empty." };
  const showWhen = input.show_when ?? "always";
  if (!SHOW_WHEN_VALUES.includes(showWhen))
    return { ok: false, error: "Nepoznata vrednost za „kada se prikazuje“." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_playbook_rules")
    .select("sort_order")
    .eq("group_id", input.group_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("tj_playbook_rules").insert({
    user_id: user.id,
    group_id: input.group_id,
    text: clean,
    show_when: showWhen,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Edit a rule.
 *
 * `show_when` is refused once the rule has been answered on any trade. The
 * follow rate for a `winner` rule is measured against winning trades; flipping
 * the value afterwards changes the denominator under answers already recorded,
 * so every historical number would silently shift. The DB enforces this too —
 * this check exists to produce a sentence instead of a constraint violation.
 */
export async function updatePlaybookRule(
  id: string,
  patch: { text?: string; show_when?: ShowWhen },
): Promise<Result> {
  const next: { text?: string; show_when?: ShowWhen } = {};
  if (patch.text != null) {
    const clean = patch.text.trim();
    if (!clean) return { ok: false, error: "The rule cannot be empty." };
    next.text = clean;
  }

  const supabase = await createClient();

  if (patch.show_when != null) {
    if (!SHOW_WHEN_VALUES.includes(patch.show_when))
      return { ok: false, error: "Nepoznata vrednost za „kada se prikazuje“." };

    const { data: current } = await supabase
      .from("tj_playbook_rules")
      .select("show_when")
      .eq("id", id)
      .maybeSingle();

    if (current && current.show_when !== patch.show_when) {
      const { count } = await supabase
        .from("tj_position_rules")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", id);
      if ((count ?? 0) > 0) {
        return {
          ok: false,
          error: `The rule is already answered on ${count} trades — "when it shows" is locked, because editing it would retroactively change the statistics. Create a new rule instead.`,
        };
      }
      next.show_when = patch.show_when;
    }
  }

  if (Object.keys(next).length === 0) return { ok: true };

  const { error } = await supabase.from("tj_playbook_rules").update(next).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Retire a rule.
 *
 * Soft delete once it has been answered, hard delete when it never was. Same
 * principle as the instrument snapshot: a journal records what happened, and
 * removing a rule must not move a single historical statistic.
 */
export async function deletePlaybookRule(id: string): Promise<Result> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("tj_position_rules")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", id);

  const { error } =
    (count ?? 0) > 0
      ? await supabase
          .from("tj_playbook_rules")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id)
      : await supabase.from("tj_playbook_rules").delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Bring a soft-deleted rule back onto the checklist. */
export async function restorePlaybookRule(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_playbook_rules")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
