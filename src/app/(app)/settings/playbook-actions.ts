"use server";

import { revalidatePath } from "next/cache";
import { revalidateTrades } from "@/lib/journal/revalidate";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { SHOW_WHEN_VALUES, type ShowWhen } from "@/lib/journal/playbook-types";
import {
  moveInOrder,
  moveRuleWithinSection,
  reorderWithinSection,
} from "@/lib/journal/playbook-order";

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/playbooks");
  revalidatePath("/trades/new");
  revalidatePath("/journal");
  revalidatePath("/reports");
  revalidateTrades();
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * `addPlaybook`'s own result, not the shared `Result`: the caller needs the
 * new row's id to open it expanded (`playbooks-screen.tsx`'s create dialog)
 * — the one thing a plain success/failure result cannot carry.
 */
type AddPlaybookResult = { ok: true; id: string } | { ok: false; error: string };

// --- Playbooks --------------------------------------------------------------

export async function addPlaybook(
  name: string,
  description?: string | null,
): Promise<AddPlaybookResult> {
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
      description: description?.trim() || null,
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

  // Nothing is created alongside it: no sections, no rules. A playbook is a
  // statement of how THIS setup is traded, and handing over five headings from
  // somebody else's method — which is what the shared section list did — made
  // every new book start as a form to fill rather than a page to write.
  revalidateAll();
  return { ok: true, id: book.id };
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

// --- Sections: the headings ONE playbook has --------------------------------
//
// A section is a row in `tj_playbook_sections`, owned by a single playbook.
//
// It used to be a value in one `rule_category` option list shared by the whole
// account, and every complaint about playbooks came out of that: a new book drew
// every heading the account had, a heading could not be deleted while a rule in
// ANOTHER book sat under it, and one rule was filed the same way everywhere.
//
// Because identity is now the row's `id` and not its text, most of the old
// caution here is gone with it. There is no `value` that must never change, no
// duplicate that would silently split one heading in two across books, and no
// lazily-created list to find first.

/** Does this section exist, in this playbook, for this user? */
async function sectionInBook(
  playbookId: string,
  sectionId: string,
): Promise<Result | null> {
  const supabase = await createClient();
  // No `user_id` filter: `tj_playbook_sections_owner` scopes the read to the
  // caller, so another user's section id simply comes back empty.
  const { data } = await supabase
    .from("tj_playbook_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("playbook_id", playbookId)
    .maybeSingle();

  if (data) return null;
  return {
    ok: false,
    error: "That section is not in this playbook.",
  };
}

const sectionLabelSchema = z.string().trim().min(1).max(60);

/**
 * `addPlaybookSection`'s own result, not the shared `Result`.
 *
 * The caller may need to write rules INTO the section it just created — the
 * "Add rule group" dialog names a group and its first rules in one step — and
 * `addPlaybookRule` takes the section's id.
 */
type AddSectionResult = { ok: true; id: string } | { ok: false; error: string };

export async function addPlaybookSection(
  playbookId: string,
  rawLabel: string,
): Promise<AddSectionResult> {
  const parsed = sectionLabelSchema.safeParse(rawLabel);
  if (!parsed.success) {
    return { ok: false, error: "A section needs a name, up to 60 characters." };
  }
  const label = parsed.data;

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_playbook_sections")
    .select("sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("tj_playbook_sections")
    .insert({
      user_id: user.id,
      playbook_id: playbookId,
      label,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();

  if (error || !created) {
    // Scoped to the playbook by `tj_playbook_sections_book_label_idx`, so the
    // same heading in a DIFFERENT book is fine — which is the whole point.
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? `This playbook already has a "${label}" section.`
          : (error?.message ?? "Insert failed"),
    };
  }

  revalidateAll();
  return { ok: true, id: created.id };
}

/**
 * Edit a section's name and the line under it.
 *
 * A rename touches nothing else: links point at the row's `id`. The old version
 * of this had to refuse to change the stored `value`, because rules carried it
 * as text and any row missed by the UPDATE would drop out of its own section.
 */
export async function updatePlaybookSection(
  id: string,
  patch: { label?: string; description?: string | null },
): Promise<Result> {
  const next: { label?: string; description?: string | null } = {};

  if (patch.label !== undefined) {
    const parsed = sectionLabelSchema.safeParse(patch.label);
    if (!parsed.success) {
      return { ok: false, error: "A section needs a name, up to 60 characters." };
    }
    next.label = parsed.data;
  }

  if (patch.description !== undefined) {
    const description = patch.description?.trim() ?? "";
    if (description.length > 200) {
      return { ok: false, error: "The description can be up to 200 characters." };
    }
    next.description = description || null;
  }

  if (Object.keys(next).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_playbook_sections")
    .update(next)
    .eq("id", id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "This playbook already has a section with that name."
          : error.message,
    };
  }

  revalidateAll();
  return { ok: true };
}

/**
 * Delete a section from ONE playbook, and let its rules go with it.
 *
 * Never refuses. `ON DELETE CASCADE` on `section_id` removes the LINKS, not the
 * rules: every rule stays in the library with every answer it ever collected,
 * and every other playbook linking it is untouched. Deleting a section is an
 * unlink of several rules at once, and unlink has never been destructive here.
 *
 * The caller confirms first, naming the rules it can already see on the card —
 * no round trip for a count, because the card holds exactly the links this
 * would remove. That is where the caution belongs: in a sentence the trader
 * reads, not in a refusal they cannot act on.
 */
export async function deletePlaybookSection(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_playbook_sections")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}

/**
 * Put this playbook's sections in an explicit order — the drag-and-drop write.
 *
 * Scoped to one book by the read, so a section id from another playbook is
 * simply absent from `known` and never gets an ordinal written to it.
 */
export async function reorderPlaybookSections(
  playbookId: string,
  orderedIds: string[],
): Promise<Result> {
  const supabase = await createClient();
  const { data: sections, error } = await supabase
    .from("tj_playbook_sections")
    .select("id, sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order")
    .order("id");
  if (error) return { ok: false, error: error.message };
  if (!sections?.length) return { ok: false, error: "No sections yet." };

  const known = new Map(sections.map((s) => [s.id, s.sort_order]));
  const wanted = orderedIds.filter((id) => known.has(id));
  // Anything the client did not name keeps its place at the end, in the order
  // the database already has — a stale list must not silently drop a section.
  const rest = sections.map((s) => s.id).filter((id) => !wanted.includes(id));
  const ordered = [...wanted, ...rest];

  const writes = ordered
    .map((id, ordinal) => ({ id, ordinal }))
    .filter(({ id, ordinal }) => known.get(id) !== ordinal);
  if (writes.length === 0) return { ok: true };

  const results = await Promise.all(
    writes.map(({ id, ordinal }) =>
      supabase
        .from("tj_playbook_sections")
        .update({ sort_order: ordinal })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidateAll();
  return { ok: true };
}

/** Move a section one place — the keyboard path for what the grip does. */
export async function movePlaybookSection(
  playbookId: string,
  id: string,
  direction: -1 | 1,
): Promise<Result> {
  const supabase = await createClient();
  const { data: sections, error } = await supabase
    .from("tj_playbook_sections")
    .select("id, sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order")
    .order("id");
  if (error) return { ok: false, error: error.message };
  if (!sections?.length) return { ok: false, error: "No sections yet." };

  const ordered = moveInOrder(
    sections.map((s) => s.id),
    id,
    direction,
  );
  // Already at the end, or not in this book. Reported as success because
  // nothing failed and nothing should change — same as `movePlaybookRule`.
  if (!ordered) return { ok: true };

  const ordinalOf = new Map(sections.map((s) => [s.id, s.sort_order]));
  const writes = ordered
    .map((sectionId, ordinal) => ({ sectionId, ordinal }))
    .filter(({ sectionId, ordinal }) => ordinalOf.get(sectionId) !== ordinal);

  const results = await Promise.all(
    writes.map(({ sectionId, ordinal }) =>
      supabase
        .from("tj_playbook_sections")
        .update({ sort_order: ordinal })
        .eq("id", sectionId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidateAll();
  return { ok: true };
}

// --- Links: which rules a playbook uses, and where it files them ------------
//
// This replaces the group actions. A group was a name owned by ONE playbook and
// rules cascaded from it, so removing a rule from a book destroyed the rule and
// its recorded answers. A link is the opposite: severing it says "this book no
// longer uses that rule" and leaves the rule, and every answer ever given to
// it, exactly where they were.
//
// The link carries the section and the setup-criterion flag, which is what lets
// one rule be an Entry criterion in one book and plain Exit process in another.

export async function linkRule(
  playbookId: string,
  ruleId: string,
  sectionId: string,
): Promise<Result> {
  const bad = await sectionInBook(playbookId, sectionId);
  if (bad) return bad;

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
    section_id: sectionId,
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
 * File a rule under a different section OF THIS PLAYBOOK.
 *
 * The move the old schema could not express. `updatePlaybookRule({ category })`
 * used to do this job by rewriting the rule itself, which moved it in every
 * playbook at once — so a rule that is "Entry" in the swing book could not be
 * "Exit" in the scalp book without being copied, and a copy is a second id with
 * its own separate statistics.
 *
 * Appended at the end of the target section: a drop from a menu names no
 * position, and the grip is there for the trader who wants one.
 */
export async function moveRuleToSection(
  playbookId: string,
  ruleId: string,
  sectionId: string,
): Promise<Result> {
  const bad = await sectionInBook(playbookId, sectionId);
  if (bad) return bad;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("tj_playbook_rule_links")
    .select("sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("tj_playbook_rule_links")
    .update({ section_id: sectionId, sort_order: (last?.sort_order ?? -1) + 1 })
    .eq("playbook_id", playbookId)
    .eq("rule_id", ruleId);
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}

/**
 * Does this rule grade the setup IN THIS PLAYBOOK?
 *
 * Per link, because the derived grade is per playbook — `criteriaByPlaybook` in
 * `reports/rule-lookup.ts` was already keyed that way and only ever read a flag
 * that could not vary. "Sweep of a daily level" can decide the grade in a swing
 * book and be ordinary process in a scalp one.
 *
 * The database refuses a criterion whose rule is not `show_when = 'always'`; a
 * raw trigger message would be unreadable, so the reason is spelled out here
 * and still enforced there.
 */
export async function setRuleCriterion(
  playbookId: string,
  ruleId: string,
  on: boolean,
): Promise<Result> {
  const supabase = await createClient();

  if (on) {
    const { data: rule } = await supabase
      .from("tj_playbook_rules")
      .select("show_when")
      .eq("id", ruleId)
      .maybeSingle();
    if (rule && rule.show_when !== "always") {
      return {
        ok: false,
        error:
          "Only a rule that shows on every trade can grade the setup. A criterion asked just of winners would judge the setup already knowing the outcome, which is the whole thing the grade is meant to avoid.",
      };
    }
  }

  const { error } = await supabase
    .from("tj_playbook_rule_links")
    .update({ is_setup_criterion: on })
    .eq("playbook_id", playbookId)
    .eq("rule_id", ruleId);
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}

/**
 * Move a rule one place within its section, inside ONE playbook.
 *
 * The ordinal lives on the LINK, not on the rule, and that is the entire reason
 * this is possible: a rule linked into three books can sit third in one and
 * first in another, and reordering here must not disturb the other two. Every
 * statement below is scoped to `playbookId` for that reason.
 *
 * The ordering itself is `moveRuleWithinSection`, which is pure and tested —
 * this function only reads, delegates, and writes back. It used to take a
 * SECOND read of `tj_playbook_rules` just to learn each rule's section; the
 * section is on the link now, so one read answers everything.
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
    .select("id,rule_id,section_id,sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order")
    .order("id");
  if (linkError) return { ok: false, error: linkError.message };
  if (!links?.length) return { ok: false, error: "Playbook not found." };

  const ordered = moveRuleWithinSection(
    links.map((l) => ({ ruleId: l.rule_id, sectionId: l.section_id })),
    ruleId,
    direction,
  );
  // Already at the end of its section, or not in this book. Reported as success
  // because nothing failed and nothing should change — same as `moveFieldDef`.
  if (!ordered) return { ok: true };

  return writeLinkOrder(links, ordered);
}

/**
 * Put one section's rules in an explicit order — the drag-and-drop write.
 *
 * `movePlaybookRule` moves one rule one place and is still what the keyboard
 * path uses; this takes the finished order in one go, because a drag across six
 * rows is one gesture and replaying it as five adjacent swaps would be five
 * round trips and five chances to half-apply.
 *
 * The slot arithmetic — a section's rules occupy scattered absolute positions
 * in the playbook's single flat link order — lives in `reorderWithinSection`,
 * pure and tested.
 */
export async function reorderPlaybookRules(
  playbookId: string,
  sectionId: string,
  orderedRuleIds: string[],
): Promise<Result> {
  const supabase = await createClient();

  const { data: links, error: linkError } = await supabase
    .from("tj_playbook_rule_links")
    .select("id,rule_id,section_id,sort_order")
    .eq("playbook_id", playbookId)
    .order("sort_order")
    .order("id");
  if (linkError) return { ok: false, error: linkError.message };
  if (!links?.length) return { ok: false, error: "Playbook not found." };

  const ordered = reorderWithinSection(
    links.map((l) => ({ ruleId: l.rule_id, sectionId: l.section_id })),
    sectionId,
    orderedRuleIds,
  );
  // Nothing to do: the drop landed where the rule already was, or the client
  // sent an order this playbook cannot satisfy. Success, because nothing failed.
  if (!ordered) return { ok: true };

  return writeLinkOrder(links, ordered);
}

/**
 * Write a finished link order back, touching only the rows that moved.
 *
 * Shared by both reorder paths, which read the same shape and differ only in
 * which pure function produced the array. Dispatched together: the ordinals are
 * independent and there is no unique index to collide with. Every result is
 * inspected, per `reorderOptions` — a half-applied reorder that reported success
 * would snap back on the next load with nothing saying why.
 */
async function writeLinkOrder(
  links: readonly { id: string; rule_id: string; sort_order: number }[],
  ordered: readonly string[],
): Promise<Result> {
  const supabase = await createClient();
  const linkOf = new Map(links.map((l) => [l.rule_id, l]));
  const writes = ordered
    .map((rid, ordinal) => ({ link: linkOf.get(rid)!, ordinal }))
    // Only the rows whose ordinal actually moved. `moveFieldDef` writes all N
    // sequentially; on a thirty-rule playbook that is thirty round trips for a
    // swap of two. The normalising effect above is kept — a duplicate ordinal
    // differs from its new index, so it is in this list.
    .filter(({ link, ordinal }) => link && link.sort_order !== ordinal);

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
 * `playbook_id` / `section_id` are optional because the two acts are genuinely
 * separate: a rule can be written once and linked into three books under three
 * different headings, or written from inside one section and filed there
 * immediately. The rule itself is the same row either way, which is what keeps
 * a rule reused from becoming a rule retyped.
 */
export async function addPlaybookRule(input: {
  text: string;
  show_when?: ShowWhen;
  playbook_id?: string;
  section_id?: string;
}): Promise<Result> {
  const clean = input.text.trim();
  if (!clean) return { ok: false, error: "The rule cannot be empty." };
  const showWhen = input.show_when ?? "always";
  if (!SHOW_WHEN_VALUES.includes(showWhen))
    return { ok: false, error: "Unknown value for \"when it shows\"." };
  if ((input.playbook_id == null) !== (input.section_id == null)) {
    return {
      ok: false,
      error: "A rule is filed into a playbook AND a section, or into neither.",
    };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Across the whole library now. The ordinal used to be scoped to the rule's
  // category, which no longer exists — and which is why the library's own order
  // was ambiguous whenever two categories reached the same count.
  const { data: last } = await supabase
    .from("tj_playbook_rules")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: rule, error } = await supabase
    .from("tj_playbook_rules")
    .insert({
      user_id: user.id,
      text: clean,
      show_when: showWhen,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !rule) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  if (input.playbook_id && input.section_id) {
    const link = await linkRule(input.playbook_id, rule.id, input.section_id);
    if (!link.ok) return link;
  }

  revalidateAll();
  return { ok: true };
}

/**
 * Edit a rule, in the library — so in every playbook that links it.
 *
 * Only the two fields that genuinely belong to the rule are here. Where it is
 * filed and whether it grades the setup moved to the link, and are set by
 * `moveRuleToSection` and `setRuleCriterion`.
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

      // The second half of the same rule the criterion trigger enforces: a
      // criterion has to show on every trade, so a rule that grades the setup
      // ANYWHERE cannot be narrowed to winners. Named here rather than left to
      // the trigger, so the refusal says which playbooks are in the way.
      if (patch.show_when !== "always") {
        const { count: criteria } = await supabase
          .from("tj_playbook_rule_links")
          .select("id", { count: "exact", head: true })
          .eq("rule_id", id)
          .eq("is_setup_criterion", true);
        if ((criteria ?? 0) > 0) {
          return {
            ok: false,
            error: `This rule grades the setup in ${criteria} ${criteria === 1 ? "playbook" : "playbooks"}, so it has to show on every trade. Turn the grade pill off there first.`,
          };
        }
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

// --- View preference: which cards start expanded ----------------------------

/**
 * Playbook ids EXPANDED on /playbooks.
 *
 * Was the collapsed set (see 20260822170000) until the list became a compact
 * table: every number worth a glance at is visible collapsed now, so opening a
 * card is a deliberate action and the untouched default flipped to collapsed.
 * The stored list flipped with it, by the same "absent means the default"
 * idiom `dashboard_hidden_widgets` already uses — an id belonging to a
 * playbook created after this shipped is absent, and absent must mean
 * collapsed, not expanded.
 *
 * Not validated against the caller's actual playbook list, for the same reason
 * `setDashboardHiddenWidgets` does not check the widget registry: this table
 * lives in `tj_playbooks`, is per-user, and changes constantly — a server-side
 * membership check would mean reading it before every write for no real
 * protection, since an id belonging to nothing is inert on the way back out
 * (`PlaybooksScreen` only ever tests `expanded.has(book.id)`). Size and shape
 * are the only real risks, which is what this bounds.
 */
const expandedSchema = z.array(z.string().min(1).max(64)).max(200);

export async function setPlaybooksExpanded(ids: string[]): Promise<Result> {
  const parsed = expandedSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid playbook selection." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Deduped so a double toggle cannot grow the array without bound.
  const expanded = [...new Set(parsed.data)];

  const { error } = await supabase.from("tj_user_prefs").upsert(
    { user_id: user.id, playbooks_expanded: expanded },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  // Only this page reads it — the heavier `revalidateAll()` above exists for
  // mutations that change what a rule or a playbook actually IS, which a
  // client-side view preference never does.
  revalidatePath("/playbooks");
  return { ok: true };
}
