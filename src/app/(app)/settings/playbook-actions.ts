"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import {
  RULE_CATEGORIES,
  SHOW_WHEN_VALUES,
  type RuleCategory,
  type ShowWhen,
} from "@/lib/journal/playbook-types";
import { moveRuleWithinCategory } from "@/lib/journal/playbook-order";

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/playbooks");
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

  // No starter groups any more. A rule carries its own category, so an empty
  // playbook is a playbook with nothing linked yet — not a dead end.
  revalidateAll();
  return { ok: true };
}

export async function updatePlaybook(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    is_active?: boolean;
    default_risk_pct?: number | null;
    a_plus_criteria?: string | null;
  },
): Promise<Result> {
  const next: {
    name?: string;
    description?: string | null;
    is_active?: boolean;
    default_risk_pct?: number | null;
    a_plus_criteria?: string | null;
  } = {};
  if (patch.name != null) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "The name cannot be empty." };
    next.name = clean;
  }
  if (patch.description !== undefined)
    next.description = patch.description?.trim() || null;
  if (patch.is_active != null) next.is_active = patch.is_active;
  if (patch.a_plus_criteria !== undefined)
    next.a_plus_criteria = patch.a_plus_criteria?.trim() || null;
  if (patch.default_risk_pct !== undefined) {
    const r = patch.default_risk_pct;
    // Mirrors the DB CHECK so the user reads a sentence, not a constraint. Zero
    // is refused rather than stored: "risk nothing" is not a default, it is a
    // cleared field, and null already says that.
    if (r != null && (!Number.isFinite(r) || r <= 0 || r > 100))
      return { ok: false, error: "Default risk must be between 0 and 100 %." };
    next.default_risk_pct = r;
  }
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
      error: `${count} trades use this playbook — deactivate it instead of deleting.`,
    };
  }

  const { error } = await supabase.from("tj_playbooks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// --- Links: which rules a playbook uses -------------------------------------
//
// This replaces the group actions. A group was a name owned by ONE playbook and
// rules cascaded from it, so removing a rule from a book destroyed the rule and
// its recorded answers. A link is the opposite: severing it says "this book no
// longer uses that rule" and leaves the rule, and every answer ever given to
// it, exactly where they were.

export async function linkRule(
  playbookId: string,
  ruleId: string,
): Promise<Result> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_playbook_rule_links")
    .select("sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("tj_playbook_rule_links").insert({
    user_id: user.id,
    playbook_id: playbookId,
    rule_id: ruleId,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "That rule is already in this playbook."
          : error.message,
    };
  }
  revalidateAll();
  return { ok: true };
}

/**
 * Take a rule out of one playbook.
 *
 * Never asks whether the rule has been answered, and that is the whole point of
 * the library: the answers belong to the RULE, not to this book's use of it. A
 * rule dropped from OTE keeps every answer it collected there, and keeps
 * collecting them in whatever other playbook still links it.
 */
export async function unlinkRule(
  playbookId: string,
  ruleId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_playbook_rule_links")
    .delete()
    .eq("playbook_id", playbookId)
    .eq("rule_id", ruleId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Move a rule one place within its category, inside ONE playbook.
 *
 * The ordinal lives on the LINK, not on the rule, and that is the entire reason
 * this is possible: a rule linked into three books can sit third in one and
 * first in another, and reordering here must not disturb the other two. Every
 * statement below is scoped to `playbookId` for that reason.
 *
 * The ordering itself is `moveRuleWithinCategory`, which is pure and tested —
 * this function only reads, delegates, and writes back.
 *
 * WHY IT REWRITES ORDINALS FROM AN ARRAY
 *
 * `moveFieldDef` does the same and explains it as deadlock avoidance. That is
 * not the reason here: `tj_playbook_rule_links` carries only
 * `UNIQUE (playbook_id, rule_id)`, so two links may legally share a
 * `sort_order` and a two-row swap would not deadlock. The reason is that they
 * legally may — `linkRule` assigns `max + 1` through a read-then-write, so two
 * links added at once can claim the same ordinal, and from then on their order
 * is whatever the `id` tiebreak happens to give. Numbering the whole array
 * normalises that on the first arrow click instead of preserving the ambiguity.
 */
export async function movePlaybookRule(
  playbookId: string,
  ruleId: string,
  direction: -1 | 1,
): Promise<Result> {
  const supabase = await createClient();

  // No explicit user_id filter anywhere in here: `tj_playbook_rule_links_owner`
  // scopes both the read and the writes to the caller, so somebody else's
  // playbook id comes back with zero links and stops at the guard below.
  const { data: links, error: linkError } = await supabase
    .from("tj_playbook_rule_links")
    .select("id,rule_id,sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order")
    .order("id");
  if (linkError) return { ok: false, error: linkError.message };
  if (!links?.length) return { ok: false, error: "Playbook not found." };

  // The category is on the rule, not the link, so it takes a second read. Only
  // the rules this book actually links.
  const { data: rules, error: ruleError } = await supabase
    .from("tj_playbook_rules")
    .select("id,category")
    .in("id", links.map((l) => l.rule_id));
  if (ruleError) return { ok: false, error: ruleError.message };

  const categoryOf = new Map((rules ?? []).map((r) => [r.id, r.category as RuleCategory]));
  const ordered = moveRuleWithinCategory(
    links.flatMap((l) => {
      const category = categoryOf.get(l.rule_id);
      // A link whose rule vanished would otherwise become an `undefined`
      // category that groups with every other orphan. Dropped instead — it is
      // not drawn either.
      return category ? [{ ruleId: l.rule_id, category }] : [];
    }),
    ruleId,
    direction,
  );
  // Already at the end of its category, or not in this book. Reported as
  // success because nothing failed and nothing should change — same as
  // `moveFieldDef`.
  if (!ordered) return { ok: true };

  const linkOf = new Map(links.map((l) => [l.rule_id, l]));
  const writes = ordered
    .map((rid, ordinal) => ({ link: linkOf.get(rid)!, ordinal }))
    // Only the rows whose ordinal actually moved. `moveFieldDef` writes all N
    // sequentially; on a thirty-rule playbook that is thirty round trips for a
    // swap of two. The normalising effect above is kept — a duplicate ordinal
    // differs from its new index, so it is in this list.
    .filter(({ link, ordinal }) => link.sort_order !== ordinal);

  // Dispatched together: the ordinals are independent and there is no unique
  // index to collide with. Every result is inspected, per `reorderOptions` —
  // a half-applied reorder that reported success would snap back on the next
  // load with nothing saying why.
  const results = await Promise.all(
    writes.map(({ link, ordinal }) =>
      supabase
        .from("tj_playbook_rule_links")
        .update({ sort_order: ordinal })
        .eq("id", link.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidateAll();
  return { ok: true };
}

// --- Rules ------------------------------------------------------------------

/**
 * Write a rule into the library, and optionally link it into a playbook.
 *
 * `playbook_id` is optional because the two acts are genuinely separate now: a
 * rule can be written once and linked into three books, or written from inside
 * one book and linked immediately. Writing it takes the same shape either way,
 * which is what keeps a rule reused from becoming a rule retyped.
 */
export async function addPlaybookRule(input: {
  category: RuleCategory;
  text: string;
  show_when?: ShowWhen;
  playbook_id?: string;
}): Promise<Result> {
  const clean = input.text.trim();
  if (!clean) return { ok: false, error: "The rule cannot be empty." };
  const showWhen = input.show_when ?? "always";
  if (!SHOW_WHEN_VALUES.includes(showWhen))
    return { ok: false, error: "Unknown value for \"when it shows\"." };
  if (!RULE_CATEGORIES.includes(input.category))
    return { ok: false, error: "Unknown rule category." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_playbook_rules")
    .select("sort_order")
    .eq("category", input.category)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: rule, error } = await supabase
    .from("tj_playbook_rules")
    .insert({
      user_id: user.id,
      category: input.category,
      text: clean,
      show_when: showWhen,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !rule) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  if (input.playbook_id) {
    const link = await linkRule(input.playbook_id, rule.id);
    if (!link.ok) return link;
  }

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
  patch: { text?: string; show_when?: ShowWhen; category?: RuleCategory },
): Promise<Result> {
  const next: { text?: string; show_when?: ShowWhen; category?: RuleCategory } = {};
  if (patch.text != null) {
    const clean = patch.text.trim();
    if (!clean) return { ok: false, error: "The rule cannot be empty." };
    next.text = clean;
  }
  // Unlike `show_when`, the category is NOT frozen once answered. It only
  // decides where the rule is drawn; no statistic counts a denominator from it,
  // so moving "waited for the sweep" from entry to context changes nothing that
  // was already measured.
  if (patch.category != null) {
    if (!RULE_CATEGORIES.includes(patch.category))
      return { ok: false, error: "Unknown rule category." };
    next.category = patch.category;
  }

  const supabase = await createClient();

  if (patch.show_when != null) {
    if (!SHOW_WHEN_VALUES.includes(patch.show_when))
      return { ok: false, error: "Unknown value for \"when it shows\"." };

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

// --- View preference: which cards start collapsed --------------------------

/**
 * Playbook ids collapsed on /playbooks.
 *
 * Not validated against the caller's actual playbook list, for the same reason
 * `setDashboardHiddenWidgets` does not check the widget registry: this table
 * lives in `tj_playbooks`, is per-user, and changes constantly — a server-side
 * membership check would mean reading it before every write for no real
 * protection, since an id belonging to nothing is inert on the way back out
 * (`PlaybooksScreen` only ever tests `collapsed.has(book.id)`). Size and shape
 * are the only real risks, which is what this bounds.
 */
const collapsedSchema = z.array(z.string().min(1).max(64)).max(200);

export async function setPlaybooksCollapsed(ids: string[]): Promise<Result> {
  const parsed = collapsedSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid playbook selection." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Deduped so a double toggle cannot grow the array without bound.
  const collapsed = [...new Set(parsed.data)];

  const { error } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, playbooks_collapsed: collapsed },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  // Only this page reads it — the heavier `revalidateAll()` above exists for
  // mutations that change what a rule or a playbook actually IS, which a
  // client-side view preference never does.
  revalidatePath("/playbooks");
  return { ok: true };
}
