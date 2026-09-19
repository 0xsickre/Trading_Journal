"use server";

import { revalidateOptions } from "@/lib/journal/revalidate";
import { createClient } from "@/lib/supabase/server";
import { RESERVED_KEYS } from "@/lib/journal/reserved-keys";
import { getCurrentUser } from "@/lib/supabase/user";
import {
  EMPTY_USAGE,
  UNKNOWN_USAGE,
  usageIsEmpty,
  type AccountUsage,
} from "@/lib/journal/account-usage";
import { getAccountUsage } from "@/lib/journal/account-usage-queries";
import {
  getOptionFieldTargets,
  getOptionUsage,
} from "@/lib/journal/option-usage-queries";
import { getAllFormFields } from "@/lib/journal/form-config";
import { RESET_PHRASE } from "@/lib/journal/reset-phrase";
import { isValidTimeZone, DEFAULT_TZ } from "@/lib/journal/time";
import {
  fieldTypeForSelection,
  FIELD_DEF_PHASES,
  FIELD_DEF_TYPES,
  slugifyFieldKey,
  type CategorySelection,
  type FieldDefPhase,
  type FieldDefType,
} from "@/lib/journal/field-def-types";
import type { OptionItem } from "@/lib/journal/types";
import { z } from "zod";
import {
  listProtection,
  moveRefusal,
  newCategoryKey,
  renameCollision,
  selectionChangeRefusal,
  siblingLists,
  type DefShape,
} from "@/lib/journal/settings-rules";

/**
 * True when PostgREST could not find the function — a migration not applied yet.
 *
 * The two new RPCs (`tj_rename_option`, `tj_delete_list`) ship with a migration
 * the database may not have yet. Until it does, the old two-step path still
 * runs rather than every rename and delete failing outright.
 */
function missingFunction(error: { code?: string; message: string } | null): boolean {
  return (
    error != null &&
    (error.code === "PGRST202" || /could not find the function/i.test(error.message))
  );
}

/** The field definitions that read `listKey`, as protection needs them. */
async function defsForList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listKey: string,
): Promise<{ ok: true; defs: DefShape[] } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("tj_field_defs")
    .select("key, list_key")
    .eq("list_key", listKey);
  if (error) return { ok: false, error: error.message };
  return { ok: true, defs: data ?? [] };
}

/**
 * Trades using ANY value of a list, or -1 when a count failed.
 *
 * One unreadable value makes the total unreadable: a guard fed a partial sum
 * would read "unused" for a category that is not.
 */
async function tradesUsingList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listId: string,
  listKey: string,
): Promise<number> {
  const { data: items, error } = await supabase
    .from("tj_option_items")
    .select("value")
    .eq("list_id", listId);
  if (error) return -1;
  const values = (items ?? []).map((i) => i.value);
  const perValue = await getOptionUsage(listKey, values);
  let total = 0;
  for (const v of values) {
    const n = perValue[v]?.trades ?? 0;
    if (n < 0) return -1;
    total += n;
  }
  return total;
}

// `OptionItem` itself rather than a structural copy of it: the copy was already
// a second place to remember every column, and it drifted the moment one was
// added — the callers assign this straight into `OptionItem[]` state.
export type AddOptionResult =
  | { ok: true; item: OptionItem }
  | { ok: false; error: string };

const revalidateAll = revalidateOptions;

/** Add a new option to a list identified by its `key` (used by inline "+ Add"). */
export async function addOption(
  listKey: string,
  rawLabel: string,
): Promise<AddOptionResult> {
  const label = rawLabel.trim();
  if (!label) return { ok: false, error: "Value cannot be empty." };

  const supabase = await createClient();
  const { data: list } = await supabase
    .from("tj_option_lists")
    .select("id")
    .eq("key", listKey)
    .maybeSingle();
  if (!list) return { ok: false, error: "List not found." };

  // The next ordinal is computed inside the INSERT. Reading MAX(sort_order)
  // here and inserting in a second request let two near-simultaneous adds read
  // the same maximum and claim the same position.
  // Returns a composite row, not a set — PostgREST sends the object directly.
  const { data, error } = await supabase.rpc("tj_add_option_item", {
    p_list_id: list.id,
    p_label: label,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return {
    ok: true,
    item: {
      id: data.id,
      value: data.value,
      label: data.label,
      color: data.color,
      description: data.description,
      is_active: data.is_active,
      sort_order: data.sort_order,
    },
  };
}

/**
 * Rename an option, and carry the trades that hold it along.
 *
 * A trade stores the option's VALUE as text, not a reference to its row. So
 * this used to update the option and stop, leaving every trade tagged with the
 * old string pointing at something no list supplied any more — the report
 * dimension dropped them out of its bucket order and the history split in two,
 * silently. A rename means "the same thing, under a new name", so the trades
 * come with it.
 *
 * The rewrite runs FIRST. If it fails the option keeps its old name and nothing
 * has drifted; the other order would leave the list renamed and the trades
 * behind, which is the exact state this function exists to prevent.
 */
export async function renameOption(id: string, label: string) {
  const supabase = await createClient();
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "The name cannot be empty." };

  // The list key, so the cascade knows which fields could be carrying it, and
  // the old value, which is what the trades actually hold.
  const { data: current, error: readError } = await supabase
    .from("tj_option_items")
    .select("value, tj_option_lists!inner(key)")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!current) return { ok: false, error: "Option not found." };

  const oldValue = current.value;
  const listKey = (current.tj_option_lists as unknown as { key: string }).key;

  // A name already in this list — or in a sibling list writing to the same
  // column (Emotion / Discipline) — would merge two tags into one on every trade
  // that holds either. Refused before anything is written.
  const siblings = siblingLists(listKey);
  const { data: others, error: othersError } = await supabase
    .from("tj_option_items")
    .select("id, value, tj_option_lists!inner(key)")
    .in("tj_option_lists.key", siblings);
  if (othersError) return { ok: false, error: othersError.message };
  const collision = renameCollision(
    trimmed,
    oldValue,
    (others ?? []).filter((o) => o.id !== id).map((o) => o.value),
  );
  if (collision) return { ok: false, error: collision };

  const targets = await getOptionFieldTargets(listKey);

  // ONE transaction: the trades and the option change together or not at all.
  // It used to be the cascade, then a separate update — a failure between them
  // left every trade on the new name and the list still offering the old one.
  const { error: rpcError } = await supabase.rpc("tj_rename_option", {
    p_item_id: id,
    p_targets: targets,
    p_new: trimmed,
  });
  if (!rpcError) {
    revalidateAll();
    return { ok: true };
  }
  if (!missingFunction(rpcError)) return { ok: false, error: rpcError.message };

  // Fallback until the migration is applied: the old order, cascade first, so a
  // failure leaves the option on its old name and nothing drifted.
  if (oldValue !== trimmed && targets.length > 0) {
    const { error: cascadeError } = await supabase.rpc("tj_rename_option_value", {
      p_targets: targets,
      p_old: oldValue,
      p_new: trimmed,
    });
    if (cascadeError) return { ok: false, error: cascadeError.message };
  }
  const { data: renamed, error } = await supabase
    .from("tj_option_items")
    .update({ label: trimmed, value: trimmed })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!renamed || renamed.length === 0) return { ok: false, error: "Option not found." };
  revalidateAll();
  return { ok: true };
}

/**
 * What one account is holding, read when its delete dialog opens.
 *
 * Was loaded for EVERY account with the Settings page — three head counts each,
 * so five accounts meant fifteen queries on every visit, to fill in a number in
 * a confirmation nobody had opened. The counts are exact and the dialog still
 * refuses to enable Delete until they land; the only thing that changed is
 * when they are asked for.
 */
export async function countAccountUsage(
  accountId: string,
): Promise<{ ok: true; usage: AccountUsage } | { ok: false; error: string }> {
  const usage = await getAccountUsage([accountId]);
  return { ok: true, usage: usage[accountId] ?? UNKNOWN_USAGE };
}

/**
 * How many trades hold this option, for the dialog that is about to change it.
 *
 * Read on demand rather than with the page. `AccountSettings` counts its usage
 * eagerly and argues for it — a dialog that fetches on open shows an empty list
 * first and the truth a beat later — but that is three accounts. This screen
 * carries a hundred-odd options, and a hundred head counts on every Settings
 * load to serve the one popover that gets opened is the wrong trade. The
 * controls that depend on the number stay disabled until it lands, so the
 * failure mode the eager read exists to prevent — acting on a number that is
 * not there yet — cannot happen here either.
 */
export async function countOptionUsage(
  id: string,
): Promise<{ ok: true; trades: number } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tj_option_items")
    .select("value, tj_option_lists!inner(key)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Option not found." };

  const listKey = (data.tj_option_lists as unknown as { key: string }).key;
  const usage = await getOptionUsage(listKey, [data.value]);
  return { ok: true, trades: usage[data.value]?.trades ?? 0 };
}

/**
 * Delete an option outright.
 *
 * The trades that carry it KEEP their text — the value lives on the trade as a
 * string, so removing the row it came from takes it out of the dropdown, the
 * colour coding and the dimension's bucket order, and touches no history. That
 * is what the dialog promises, and it is why this can be offered at all rather
 * than only archiving.
 *
 * Archiving still exists beside it and still has a job: `exit_reason` should
 * stop being offered long before the trades that closed for it stop needing a
 * label. Delete is for the option that was a mistake; archive is for the one
 * that had its day.
 */
export async function deleteOption(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_option_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function setOptionColor(id: string, color: string | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_option_items")
    .update({ color })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Soft-delete / restore: keeps history filterable, hides from entry forms. */
export async function toggleOptionActive(id: string, is_active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_option_items")
    .update({ is_active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function reorderOptions(orderedIds: string[]) {
  const supabase = await createClient();
  // Every result is inspected. This used to `await Promise.all(...)` and throw
  // the array away, then return `{ ok: true }` unconditionally — so a reorder
  // that half-applied reported success, the list snapped back on the next load,
  // and nothing anywhere said why. The two sibling reorders in this codebase
  // (`moveFieldDef` below, and the tracker's) have always checked; this was the
  // odd one out.
  //
  // Still dispatched in parallel — the ordinals are independent, and one round
  // trip per option would make a long list crawl.
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("tj_option_items").update({ sort_order: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  revalidateAll();
  return { ok: true };
}

export async function addList(
  _key: string,
  label: string,
  category: string | null,
  /** When the trade form asks for it. Defaults to every phase. */
  showPhase: FieldDefPhase = "always",
  /** One tag at a time, or several. Several is the common case for a tag. */
  selection: CategorySelection = "multi",
) {
  const supabase = await createClient();

  // The key is derived from the NAME with the same rules the field definition
  // enforces, and checked BEFORE anything is inserted. `addList` used its own
  // looser derivation, so "Čekirano" or "1st setup" made a list whose key the
  // field then refused — and the list stayed behind with no field, blocking
  // every retry with "already exists".
  const [{ data: lists, error: listsError }, { data: defs, error: defsError }] =
    await Promise.all([
      supabase.from("tj_option_lists").select("key"),
      supabase.from("tj_field_defs").select("key"),
    ]);
  if (listsError) return { ok: false, error: listsError.message };
  if (defsError) return { ok: false, error: defsError.message };
  const derived = newCategoryKey(label, [
    ...(lists ?? []).map((l) => l.key),
    ...(defs ?? []).map((d) => d.key),
  ]);
  if (!derived.ok) return { ok: false, error: derived.error };
  const key = derived.key;

  // Same atomic-ordinal reasoning as addOption above.
  const { error } = await supabase.rpc("tj_add_option_list", {
    p_key: key,
    p_label: label.trim(),
    // `?? undefined`, not `category`: the RPC declares the argument optional,
    // and an explicit null would be sent as a value rather than omitted.
    p_category: category ?? undefined,
  });
  if (error) return { ok: false, error: error.message };

  // A NEW CATEGORY IS A NEW FIELD ON THE TRADE FORM — a category nothing can be
  // tagged with is a list of words. One at a time or several is the trader's
  // choice; several is the shape `technical_tag` and `mistake` already have.
  const fieldRes = await addFieldDef({
    label: label.trim(),
    field_type: fieldTypeForSelection(selection),
    show_phase: showPhase,
    list_key: key,
    key,
  });
  if (!fieldRes.ok) {
    // Taken back out, so the category is either whole or absent. Left behind, a
    // list with no field never appeared on the form and made every retry fail.
    await supabase.from("tj_option_lists").delete().eq("key", key);
    return { ok: false, error: fieldRes.error };
  }

  revalidateAll();
  return { ok: true };
}

/**
 * The same reorder, addressed by category KEY rather than row id.
 *
 * The trade form drags the fields it is rendering, and a rendered field knows
 * its `listKey` — it never sees a `tj_option_lists.id`. Rather than ship the
 * ids to the form for the sole purpose of sending them back, this takes what
 * the form already holds.
 *
 * Writes both tables for the reason `reorderLists` does: the categories screen
 * and the trade form store the same intent in two places, and a drag on either
 * one has to settle both or they drift apart again.
 */
export async function reorderCategoriesByKey(orderedKeys: string[]) {
  if (orderedKeys.length === 0) return { ok: true as const };
  const supabase = await createClient();

  const [listResults, defResults] = await Promise.all([
    Promise.all(
      orderedKeys.map((key, i) =>
        supabase.from("tj_option_lists").update({ sort_order: i }).eq("key", key),
      ),
    ),
    Promise.all(
      orderedKeys.map((key, i) =>
        supabase
          .from("tj_field_defs")
          .update({ sort_order: i })
          .eq("list_key", key),
      ),
    ),
  ]);

  const failed =
    listResults.find((r) => r.error) ?? defResults.find((r) => r.error);
  if (failed?.error) return { ok: false as const, error: failed.error.message };
  revalidateOptions();
  return { ok: true as const };
}

/**
 * The order the trader dragged the categories into.
 *
 * WRITES TWO TABLES, and it has to. The Settings table reads
 * `tj_option_lists.sort_order`; the trade form reads
 * `tj_field_defs.sort_order`, because that is the row that decides where the
 * field renders. They are the same intent stored twice, and before this they
 * could disagree — the categories screen said one order, the form drew another,
 * with nothing to reconcile them.
 *
 * Dragging is the one gesture that means "this is the order", so it settles
 * both. A category the form does not render by field def — `exit_reason` and
 * the rest, wired in by code — simply matches no row in the second write, which
 * is correct: its place on the form is not an ordinal.
 *
 * Dispatched in parallel like `reorderOptions`, and like it every result is
 * inspected: a half-applied reorder that reported success would snap back on
 * the next load with nothing anywhere saying why.
 */
export async function reorderLists(orderedIds: string[]) {
  if (orderedIds.length === 0) return { ok: true as const };
  const supabase = await createClient();

  const { data: lists, error: readError } = await supabase
    .from("tj_option_lists")
    .select("id,key")
    .in("id", orderedIds);
  if (readError) return { ok: false as const, error: readError.message };

  const keyById = new Map((lists ?? []).map((l) => [l.id, l.key]));

  // Two batches rather than one array: the builders carry their table's row
  // type, so a mixed array has no common type to be inspected through. Both are
  // still dispatched together — the ordinals are independent.
  const [listResults, defResults] = await Promise.all([
    Promise.all(
      orderedIds.map((id, i) =>
        supabase.from("tj_option_lists").update({ sort_order: i }).eq("id", id),
      ),
    ),
    Promise.all(
      orderedIds.map((id, i) => {
        const key = keyById.get(id);
        return supabase
          .from("tj_field_defs")
          .update({ sort_order: i })
          // A category with no key matches nothing, which is the same no-op as
          // one the form wires in by code.
          .eq("list_key", key ?? "");
      }),
    ),
  ]);

  const failed =
    listResults.find((r) => r.error) ?? defResults.find((r) => r.error);
  if (failed?.error) return { ok: false as const, error: failed.error.message };
  revalidateOptions();
  return { ok: true as const };
}

/**
 * One tag at a time, or several.
 *
 * Only the picker changes — the values already on trades are untouched, and
 * that is worth stating because the two are stored differently. A `tags`
 * category writes an ARRAY, a `select` writes a single string, so a category
 * switched from several to one leaves old trades carrying more than one value.
 * They keep them: the history recorded what it recorded, and rewriting it to
 * fit a setting made later would be inventing a past. The form simply stops
 * offering a second tag from here on.
 */
export async function setListSelection(
  id: string,
  selection: CategorySelection,
) {
  const supabase = await createClient();
  const { data: list, error: readError } = await supabase
    .from("tj_option_lists")
    .select("key")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!list) return { ok: false, error: "Category not found." };

  // A column-backed category stores its values in a typed column, so its shape
  // is fixed; a custom one can change shape only while no trade holds a value —
  // otherwise old trades keep a string where the form now expects a list, or
  // the other way round.
  const defs = await defsForList(supabase, list.key);
  if (!defs.ok) return { ok: false, error: defs.error };
  const refusal = selectionChangeRefusal(
    list.key,
    defs.defs,
    await tradesUsingList(supabase, id, list.key),
  );
  if (refusal) return { ok: false, error: refusal };

  const { data: touched, error } = await supabase
    .from("tj_field_defs")
    .update({ field_type: fieldTypeForSelection(selection) })
    .eq("list_key", list.key)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!touched || touched.length === 0)
    return {
      ok: false,
      error: "How this category is picked is fixed by the form.",
    };
  revalidateOptions();
  return { ok: true };
}

/**
 * When the trade form asks for this category.
 *
 * Stored on the FIELD, not the list: the list is a set of values, and the same
 * set could in principle feed more than one field. `addList` pairs the two by
 * key, so this finds the field by the list's key.
 */
export async function setListPhase(id: string, phase: FieldDefPhase) {
  if (!FIELD_DEF_PHASES.includes(phase))
    return { ok: false, error: "Unknown phase." };

  const supabase = await createClient();
  const { data: list, error: readError } = await supabase
    .from("tj_option_lists")
    .select("key")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!list) return { ok: false, error: "Category not found." };

  // `select` so a write that matched nothing is reported rather than passing
  // for a success. No row means the form renders this category by code, and the
  // phase it would have set is not a thing the trader can move.
  const { data: touched, error } = await supabase
    .from("tj_field_defs")
    .update({ show_phase: phase })
    .eq("list_key", list.key)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!touched || touched.length === 0)
    return {
      ok: false,
      error: "Where this category appears is fixed by the form.",
    };
  revalidateOptions();
  return { ok: true };
}

/** Rename a list itself — the `key` is immutable, only the display `label` moves. */
export async function renameList(id: string, label: string) {
  const supabase = await createClient();
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "The name cannot be empty." };
  const { data: renamed, error } = await supabase
    .from("tj_option_lists")
    .update({ label: trimmed })
    .eq("id", id)
    .select("key");
  if (error) return { ok: false, error: error.message };
  if (!renamed || renamed.length === 0) return { ok: false, error: "Category not found." };

  // The field the category feeds is labelled by its definition, not the list —
  // so the trade form went on showing the old name after a rename here.
  const { error: defError } = await supabase
    .from("tj_field_defs")
    .update({ label: trimmed })
    .eq("list_key", renamed[0].key);
  if (defError) return { ok: false, error: defError.message };
  revalidateAll();
  return { ok: true };
}

/** Colour for a category chip. */
export async function setListColor(id: string, color: string | null) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_option_lists")
    .update({ color })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * File a tag under a different category.
 *
 * Only the parent moves — the tag keeps its `value`, so every trade already
 * carrying it stays attached. Refused when the destination is a list a
 * BUILT-IN field reads: those fields feed a fixed dropdown, and dropping a
 * foreign tag into one would offer a value the form was never built to mean.
 */
export async function moveOptionToList(optionId: string, listId: string) {
  const supabase = await createClient();
  const [{ data: item, error: itemError }, { data: to, error: toError }] =
    await Promise.all([
      supabase
        .from("tj_option_items")
        .select("value, tj_option_lists!inner(key)")
        .eq("id", optionId)
        .maybeSingle(),
      supabase.from("tj_option_lists").select("key").eq("id", listId).maybeSingle(),
    ]);
  if (itemError) return { ok: false, error: itemError.message };
  if (toError) return { ok: false, error: toError.message };
  if (!item) return { ok: false, error: "Tag not found." };
  if (!to) return { ok: false, error: "Category not found." };

  // The tag keeps its text, so trades that hold it stay attached only if the
  // destination feeds the SAME field. Anywhere else it may move only while no
  // trade uses it. This makes the promise in the move menu true.
  const fromKey = (item.tj_option_lists as unknown as { key: string }).key;
  const toDefs = await defsForList(supabase, to.key);
  if (!toDefs.ok) return { ok: false, error: toDefs.error };
  const usage = await getOptionUsage(fromKey, [item.value]);
  const refusal = moveRefusal(
    fromKey,
    to.key,
    usage[item.value]?.trades ?? -1,
    listProtection(to.key, toDefs.defs, getAllFormFields([])) != null,
  );
  if (refusal) return { ok: false, error: refusal };

  const { error } = await supabase
    .from("tj_option_items")
    .update({ list_id: listId })
    .eq("id", optionId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export type ListUsage = {
  trades: number;
  /** A built-in (hardcoded) field reads this list — deleting it is refused. */
  builtIn: boolean;
  /** Labels of the trader's own fields that would be deleted along with it. */
  customFieldLabels: string[];
};

/**
 * What a whole list is holding, for the dialog before it goes.
 *
 * Three different costs, because a list can be three different kinds of
 * expensive: trades that recorded one of its values (survive the delete, same
 * as a single option), a built-in field that has no other source for its
 * dropdown (blocks the delete outright — there is no "pick another list" for
 * code), and the trader's own custom field, which this delete would take down
 * with it since a select with no list is not a field any more.
 */
export async function countListUsage(
  id: string,
): Promise<{ ok: true; usage: ListUsage } | { ok: false; error: string }> {
  const supabase = await createClient();
  const [{ data: list, error: listError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase.from("tj_option_lists").select("key").eq("id", id).maybeSingle(),
      supabase.from("tj_option_items").select("value").eq("list_id", id),
    ]);
  if (listError) return { ok: false, error: listError.message };
  if (!list) return { ok: false, error: "List not found." };
  if (itemsError) return { ok: false, error: itemsError.message };

  const values = (items ?? []).map((i) => i.value);
  const perValue = await getOptionUsage(list.key, values);
  let trades = 0;
  for (const v of values) {
    const n = perValue[v]?.trades ?? 0;
    // One unreadable value makes the total unreadable — the same rule
    // `getOptionUsage` already applies within a single value's own count.
    if (n < 0) {
      trades = -1;
      break;
    }
    trades += n;
  }

  const { data: fieldDefs, error: fieldError } = await supabase
    .from("tj_field_defs")
    .select("key, list_key, label")
    .eq("list_key", list.key);
  if (fieldError) return { ok: false, error: fieldError.message };

  // `listProtection`, not `isListBuiltIn(getAllFormFields([]))` alone: with no
  // definitions merged in, that call knows only `risk_pct`, so the seeded
  // categories read as the trader's own and the dialog offered to delete them.
  const protectedReason = listProtection(list.key, fieldDefs ?? [], getAllFormFields([]));
  return {
    ok: true,
    usage: {
      trades,
      builtIn: protectedReason != null,
      customFieldLabels:
        protectedReason != null ? [] : (fieldDefs ?? []).map((d) => d.label),
    },
  };
}

/**
 * Delete a list outright — the trader's own category, gone, the way TradeZella
 * lets a category go.
 *
 * REFUSED for a list a BUILT-IN field depends on (`isListBuiltIn`): that field
 * is hardcoded in `form-config.ts`, so there is no "point it elsewhere" the way
 * there is for a custom field — deleting the list would leave the field's
 * dropdown silently empty on every trade going forward.
 *
 * CASCADES to the trader's own custom field(s) when the list backs one of
 * those instead: a select or tags field with no list is not a field any
 * trader would want kept around half-alive, so the whole pairing goes
 * together — the same one-delete-does-it TradeZella model this screen copies.
 * The field's already-recorded values stay on the trades that hold them, same
 * as `deleteOption`.
 */
export async function deleteList(id: string) {
  const supabase = await createClient();
  const { data: list, error: listError } = await supabase
    .from("tj_option_lists")
    .select("key")
    .eq("id", id)
    .maybeSingle();
  if (listError) return { ok: false, error: listError.message };
  if (!list) return { ok: false, error: "Category not found." };

  const defs = await defsForList(supabase, list.key);
  if (!defs.ok) return { ok: false, error: defs.error };
  const protectedReason = listProtection(list.key, defs.defs, getAllFormFields([]));
  if (protectedReason)
    return { ok: false, error: `${protectedReason} It cannot be deleted.` };

  // One transaction: the field definition and the list go together. Two
  // requests left a category with no field when the second one failed.
  const { error: rpcError } = await supabase.rpc("tj_delete_list", { p_list_id: id });
  if (!rpcError) {
    revalidateAll();
    return { ok: true };
  }
  if (!missingFunction(rpcError)) return { ok: false, error: rpcError.message };

  // Fallback until the migration is applied.
  const { error: fieldError } = await supabase
    .from("tj_field_defs")
    .delete()
    .eq("list_key", list.key);
  if (fieldError) return { ok: false, error: fieldError.message };
  // Cascades to tj_option_items via ON DELETE CASCADE.
  const { error } = await supabase.from("tj_option_lists").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---- Instruments ----

/**
 * Contract specs that multiply into money must be strictly positive.
 *
 * `point_value` is the multiplier in `grossPl = grossPoints * point_value`: a 0
 * makes every trade on the instrument worth nothing and a negative one flips
 * the sign of all of them, silently in both cases. And the value is SNAPSHOTTED
 * onto each trade at creation, so a bad one is copied into every trade booked
 * while it stood and fixing the instrument later does not fix those trades.
 *
 * A CHECK constraint enforces the same thing in the database, which is the
 * guard that actually holds; this one exists to say why in Serbian instead of
 * raising a constraint name at the user.
 */
function badSpec(patch: {
  point_value?: number | null;
  tick_size?: number | null;
  tick_value?: number | null;
}): string | null {
  const fields: [string, number | null | undefined][] = [
    ["Point value", patch.point_value],
    ["Tick size", patch.tick_size],
    ["Tick value", patch.tick_value],
  ];
  for (const [label, v] of fields) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v <= 0) return `${label} must be greater than zero.`;
  }
  return null;
}

/**
 * The columns `updateInstrument` may write, with their ranges.
 *
 * A whitelist, because the patch arrives from the browser: without one any
 * column on the row — `user_id` included — was one field away from being set.
 */
const instrumentPatchSchema = z
  .object({
    name: z.string().max(120).nullable().optional(),
    asset_class: z.string().max(60).nullable().optional(),
    point_value: z.number().finite().positive("Point value must be greater than zero.").optional(),
    tick_size: z.number().finite().nonnegative("Tick size cannot be negative.").nullable().optional(),
    tick_value: z.number().finite().nonnegative("Tick value cannot be negative.").nullable().optional(),
    quote_currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency is a three-letter code.").optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export async function addInstrument(input: {
  symbol: string;
  name?: string;
  asset_class?: string;
  point_value?: number;
  tick_size?: number | null;
  tick_value?: number | null;
  quote_currency?: string;
}) {
  const supabase = await createClient();
  // Upper case, as the catalog and every import normalise symbols: "es" and
  // "ES" as two instruments would split one market's trades in two.
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { ok: false, error: "Symbol required." };
  const spec = badSpec(input);
  if (spec) return { ok: false, error: spec };
  const { error } = await supabase.from("tj_instruments").insert({
    symbol,
    name: input.name?.trim() || null,
    asset_class: input.asset_class?.trim() || null,
    point_value: input.point_value ?? 1,
    tick_size: input.tick_size ?? null,
    tick_value: input.tick_value ?? null,
    quote_currency: input.quote_currency?.trim().toUpperCase() || "USD",
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function updateInstrument(
  id: string,
  patch: {
    name?: string | null;
    asset_class?: string | null;
    point_value?: number;
    tick_size?: number | null;
    tick_value?: number | null;
    quote_currency?: string;
    is_active?: boolean;
  },
) {
  const parsed = instrumentPatchSchema.safeParse(patch);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid instrument." };
  const spec = badSpec(parsed.data);
  if (spec) return { ok: false, error: spec };
  const clean = {
    ...parsed.data,
    ...(parsed.data.quote_currency != null
      ? { quote_currency: parsed.data.quote_currency.trim().toUpperCase() }
      : {}),
  };
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("tj_instruments")
    .update(clean)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: "Instrument not found." };
  revalidateAll();
  return { ok: true };
}

export async function deleteInstrument(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tj_instruments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// ---- Accounts ----

const pct = (label: string) =>
  z.number().finite().min(0, `${label} cannot be below 0 %.`).max(100, `${label} cannot be above 100 %.`);
const money = (label: string) =>
  z.number().finite().min(0, `${label} cannot be negative.`);

/**
 * The columns `updateAccount` may write, with their ranges.
 *
 * FTMO limits are percentages and live in 0–100; costs and balances are not
 * negative; the breakeven band may be (a loss-side edge). Anything outside
 * these, or any column not listed, is refused rather than stored.
 */
const accountPatchSchema = z
  .object({
    name: z.string().trim().min(1, "The name cannot be empty.").max(80).optional(),
    broker: z.string().max(80).nullable().optional(),
    account_kind: z.enum(["trading", "backtest"]).optional(),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency is a three-letter code.").transform((c) => c.toUpperCase()).optional(),
    starting_balance: money("Starting balance").optional(),
    default_asset_class: z.string().max(60).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    is_active: z.boolean().optional(),
    breakeven_from: z.number().finite().optional(),
    breakeven_to: z.number().finite().optional(),
    breakeven_unit: z.enum(["currency", "pct"]).optional(),
    default_commission_per_unit: money("Commission").optional(),
    default_fee_fixed: money("Fixed fee").optional(),
    default_swap_per_day: z.number().finite().optional(),
    default_stop_pct: pct("Default stop").nullable().optional(),
    default_target_pct: pct("Default target").nullable().optional(),
    ftmo_mode: z.boolean().optional(),
    ftmo_daily_loss_enabled: z.boolean().optional(),
    ftmo_daily_loss_pct: pct("Daily loss limit").optional(),
    ftmo_daily_loss_basis: z.enum(["starting_balance", "prev_close"]).optional(),
    ftmo_max_loss_enabled: z.boolean().optional(),
    ftmo_max_loss_pct: pct("Max loss limit").optional(),
    ftmo_profit_target_enabled: z.boolean().optional(),
    ftmo_profit_target_pct: pct("Profit target").optional(),
    ftmo_min_days_enabled: z.boolean().optional(),
    ftmo_min_days: z.number().int("Minimum days is a whole number.").min(0).max(365).optional(),
    ftmo_reset_at: z.string().nullable().optional(),
  })
  .strict();

export async function updateAccount(
  id: string,
  patch: {
    name?: string;
    broker?: string | null;
    account_kind?: "trading" | "backtest";
    currency?: string;
    starting_balance?: number;
    default_asset_class?: string | null;
    timezone?: string;
    is_active?: boolean;
    breakeven_from?: number;
    breakeven_to?: number;
    breakeven_unit?: "currency" | "pct";
    default_commission_per_unit?: number;
    default_fee_fixed?: number;
    default_swap_per_day?: number;
    default_stop_pct?: number | null;
    default_target_pct?: number | null;
    ftmo_mode?: boolean;
    ftmo_daily_loss_enabled?: boolean;
    ftmo_daily_loss_pct?: number;
    ftmo_daily_loss_basis?: "starting_balance" | "prev_close";
    ftmo_max_loss_enabled?: boolean;
    ftmo_max_loss_pct?: number;
    ftmo_profit_target_enabled?: boolean;
    ftmo_profit_target_pct?: number;
    ftmo_min_days_enabled?: boolean;
    ftmo_min_days?: number;
    ftmo_reset_at?: string | null;
  },
) {
  // Whitelisted and ranged. The patch used to go straight to the update, so any
  // column — and any number, NaN and 1e9 % included — reached the row.
  const parsedPatch = accountPatchSchema.safeParse(patch);
  if (!parsedPatch.success)
    return { ok: false, error: parsedPatch.error.issues[0]?.message ?? "Invalid account settings." };
  patch = parsedPatch.data;

  if (
    patch.breakeven_from != null &&
    patch.breakeven_to != null &&
    patch.breakeven_from > patch.breakeven_to
  ) {
    return {
      ok: false,
      error: "Breakeven range: 'from' must be less than or equal to 'to'.",
    };
  }

  const supabase = await createClient();

  // Currency, once trades exist, is a historical fact too — more strictly than
  // `starting_balance` below. `fx_rate_at_trade` is a SNAPSHOT resolved against
  // whatever the account's currency was at the moment each trade was saved
  // (`src/lib/journal/fx.ts`, and `tj_position_stats`'s own read of it); it is
  // never recomputed. Swapping the account to a different currency does not
  // touch that snapshot — every already-logged trade keeps its old fx_rate
  // while the view relabels its money under the NEW currency, which is not a
  // relabel at all: the number stops meaning what its symbol claims, silently,
  // in every dashboard tile, drawdown figure and report that sums it. There is
  // no safe reconversion to offer (this app does not store historical market
  // FX rates), so the only honest move is to refuse the change once there is
  // a trade it would corrupt.
  //
  // Compared against the CURRENT value, not just "has trades": the settings
  // form always sends `currency` on every save (`account-settings.tsx`), so
  // gating on presence alone would block ordinary saves of an account that
  // already has trades, not just an actual currency change.
  if (patch.currency != null) {
    const { data: current, error: currentError } = await supabase
      .from("tj_accounts")
      .select("currency")
      .eq("id", id)
      .maybeSingle();
    if (currentError) return { ok: false, error: currentError.message };
    if (!current) return { ok: false, error: "Account not found." };
    if (current.currency !== patch.currency) {
      const { count, error: countError } = await supabase
        .from("tj_positions")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id);
      // A failed count refuses the change. Read as 0 it switched the lock off,
      // and the currency could change under trades already converted to it.
      if (countError)
        return {
          ok: false,
          error: "Could not check whether this account has trades, so the currency was not changed. Try again.",
        };
      if ((count ?? 0) > 0) {
        return {
          ok: false,
          error:
            "Currency can't change once trades exist on this account — every logged trade's money was already converted and locked in against the old currency, and changing this would relabel it without reconverting. Create a new account instead.",
        };
      }
    }
  }

  // starting_balance is a historical fact, not a setting: it is the denominator
  // behind every drawdown percentage, the base of every FTMO threshold and the
  // opening point of the equity curve. Changing it silently re-bases all of
  // them. A negative one would invert them, so that much is refused outright;
  // an honest correction is still allowed, but it is worth knowing it rewrites
  // how every past trade reads.
  if (patch.starting_balance != null && patch.starting_balance < 0) {
    return { ok: false, error: "Starting balance cannot be negative." };
  }

  // The account's timezone decides which calendar DAY every trade, every
  // compliance verdict and every daily total belongs to. The read path uses
  // `safeTz`, which degrades an unknown zone to the default rather than
  // throwing — right for rendering, and it makes a typo invisible: save
  // `Europe/Belgrad` and the whole journal quietly re-dates itself to New York
  // with nothing on screen that looks wrong. Refused here, where the user is
  // still looking at the field they typed it into.
  if (patch.timezone != null && !isValidTimeZone(patch.timezone)) {
    return { ok: false, error: `Unknown time zone: ${patch.timezone}` };
  }

  const { data: updated, error } = await supabase
    .from("tj_accounts")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: "Account not found." };
  revalidateAll();
  return { ok: true };
}

/** Restart the FTMO challenge: trades before now stop counting toward breaches. */
export async function resetFtmoChallenge(id: string) {
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("tj_accounts")
    .update({ ftmo_reset_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  if (!updated || updated.length === 0) return { ok: false as const, error: "Account not found." };
  revalidateAll();
  return { ok: true as const };
}

export async function addAccount(input: {
  name: string;
  currency?: string;
  starting_balance?: number;
  timezone?: string;
  default_asset_class?: string | null;
}) {
  const supabase = await createClient();
  if (!input.name.trim()) return { ok: false, error: "Name required." };
  // Same guard as `updateAccount` — a bad zone must not be creatable either.
  if (input.timezone != null && !isValidTimeZone(input.timezone)) {
    return { ok: false, error: `Unknown time zone: ${input.timezone}` };
  }
  const { error } = await supabase.from("tj_accounts").insert({
    name: input.name.trim(),
    currency: input.currency ?? "USD",
    starting_balance: input.starting_balance ?? 0,
    timezone: input.timezone ?? DEFAULT_TZ,
    default_asset_class: input.default_asset_class ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Delete an account and everything that hangs off it.
 *
 * The work happens in `tj_delete_account`, not here, for a reason worth stating:
 * `tj_positions.account_id` is ON DELETE SET NULL, so a plain delete would
 * remove the account and leave its trades behind with no account — still in
 * every total, no longer convertible to the book currency, and with nothing on
 * screen to say why. The function deletes dependants first, in one transaction.
 *
 * `confirmName` is required whenever the account holds anything. The typing is
 * not ceremony: this is the only screen in the application where one click can
 * destroy a trade record, and undo does not cover it.
 */
export async function deleteAccount(id: string, confirmName?: string) {
  const supabase = await createClient();
  // Server Actions are reachable by direct POST, not only through the dialog
  // that renders them — so the signed-in check is repeated here rather than
  // assumed from the caller.
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const { data: account } = await supabase
    .from("tj_accounts")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();
  if (!account) return { ok: false as const, error: "Account not found." };

  const usage = (await getAccountUsage([id]))[id] ?? EMPTY_USAGE;
  if (!usageIsEmpty(usage)) {
    if ((confirmName ?? "").trim() !== account.name.trim()) {
      return {
        ok: false as const,
        error: `This account is not empty. Type its name exactly — ${account.name} — to confirm.`,
      };
    }
  }

  const { error } = await supabase.rpc("tj_delete_account", {
    p_account_id: id,
  });
  if (error) {
    // The two the function raises deliberately, given back in the words the
    // screen can use. Anything else is passed through unchanged.
    if (error.message.includes("last account"))
      return {
        ok: false as const,
        error:
          "This is your only account, and the journal needs one — its timezone and currency date every trade. Create another first.",
      };
    if (error.message.includes("not found"))
      return { ok: false as const, error: "Account not found." };
    return { ok: false as const, error: error.message };
  }

  revalidateAll();
  return { ok: true as const };
}

/**
 * Delete everything this user owns and re-seed the defaults.
 *
 * Irreversible, and the only operation here that is. `RESET_PHRASE` is checked
 * on the server as well as in the dialog for the same reason the signed-in check
 * is: the action is callable without the dialog.
 */
export async function resetAllData(confirmPhrase: string) {
  if (confirmPhrase.trim() !== RESET_PHRASE) {
    return {
      ok: false as const,
      error: `Type ${RESET_PHRASE} to confirm.`,
    };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const { error } = await supabase.rpc("tj_reset_my_data");
  if (error) return { ok: false as const, error: error.message };

  // Every route reads something this just deleted, so the whole tree goes —
  // revalidating only /settings would leave the dashboard drawing a book that
  // no longer exists.
  revalidateOptions();
  return { ok: true as const };
}

// ---- Cash events (deposits / withdrawals / payouts) ----

const CASH_EVENT_TYPES = [
  "deposit",
  "withdrawal",
  "payout",
  "adjustment",
] as const;
export type CashEventType = (typeof CASH_EVENT_TYPES)[number];

/**
 * Amounts are stored signed so the balance timeline is a plain running sum.
 * The form asks for a magnitude and the sign is derived from the type here, in
 * one place, rather than trusting every caller to remember.
 */
function signedAmount(type: CashEventType, magnitude: number): number {
  const abs = Math.abs(magnitude);
  if (type === "deposit") return abs;
  if (type === "withdrawal" || type === "payout") return -abs;
  return magnitude; // adjustment keeps whatever sign was entered
}

export async function addCashEvent(input: {
  account_id: string;
  event_type: CashEventType;
  amount: number;
  occurred_at: string;
  note?: string | null;
}) {
  if (!CASH_EVENT_TYPES.includes(input.event_type))
    return { ok: false as const, error: "Unknown event type." };
  if (!input.account_id)
    return { ok: false as const, error: "Account is required." };

  const amount = signedAmount(input.event_type, Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0)
    return { ok: false as const, error: "Amount must be a non-zero number." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // The account must be one of the caller's. Under RLS another user's account
  // reads as missing; checked here so the message names it instead of a
  // foreign-key or policy error.
  const { data: account, error: accountError } = await supabase
    .from("tj_accounts")
    .select("id")
    .eq("id", input.account_id)
    .maybeSingle();
  if (accountError) return { ok: false as const, error: accountError.message };
  if (!account) return { ok: false as const, error: "Account not found." };

  const { error } = await supabase.from("tj_cash_events").insert({
    user_id: user.id,
    account_id: input.account_id,
    event_type: input.event_type,
    amount,
    occurred_at: input.occurred_at,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateAll();
  return { ok: true as const };
}

export async function deleteCashEvent(id: string) {
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("tj_cash_events")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  if (!deleted || deleted.length === 0) return { ok: false as const, error: "Entry not found." };
  revalidateAll();
  return { ok: true as const };
}

// --- User-defined trade fields ---------------------------------------------


/**
 * Storage key rules, mirroring the CHECK constraint on tj_field_defs.
 *
 * Kept strict deliberately: the key becomes a jsonb path and appears in report
 * URLs, so anything with a dot, a colon or a space would eventually be split in
 * the wrong place by something downstream.
 */
const KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;


export async function addFieldDef(input: {
  label: string;
  field_type: FieldDefType;
  /** When the trade form asks for it. Defaults to every phase. */
  show_phase?: FieldDefPhase;
  list_key?: string | null;
  key?: string;
}) {
  const label = input.label.trim();
  if (!label) return { ok: false as const, error: "The name cannot be empty." };
  if (!FIELD_DEF_TYPES.includes(input.field_type))
    return { ok: false as const, error: "Unknown field type." };
  const showPhase = input.show_phase ?? "always";
  if (!FIELD_DEF_PHASES.includes(showPhase))
    return { ok: false as const, error: "Unknown phase." };

  // A label with no letter or digit in it has no key to derive. `slugifyFieldKey`
  // strips punctuation, finds nothing left, and falls back to the bare `f` —
  // so `!!!`, `___` and `---` are three visibly different labels that all
  // become the same field. The collision itself is caught below (23505), but
  // the message it produces — "a field with that key already exists" — is
  // baffling next to a label the user can see is new. Refused at the source
  // instead, where the reason can be stated.
  if (!/[a-z0-9]/i.test(label.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
    return {
      ok: false as const,
      error: "The name must contain at least one letter or digit.",
    };

  const key = (input.key?.trim() || slugifyFieldKey(label)).toLowerCase();
  if (!KEY_RE.test(key))
    return {
      ok: false as const,
      error: "The key must start with a letter and contain only lowercase letters, digits and _.",
    };
  if (RESERVED_KEYS.has(key))
    return {
      ok: false as const,
      error: `"${key}" is a reserved column name — pick another.`,
    };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Append to the end of the trader's list. One ordering now that the four
  // groups are gone — the ordinal used to be unique only within a group, and
  // reading the max across all of them would have collided.
  const { data: last } = await supabase
    .from("tj_field_defs")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("tj_field_defs").insert({
    user_id: user.id,
    key,
    label,
    field_type: input.field_type,
    // Only select / tags read an option list; storing one on a text field would
    // be a promise the form does not keep.
    list_key:
      input.field_type === "select" || input.field_type === "tags"
        ? (input.list_key?.trim() || key)
        : null,
    show_phase: showPhase,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    return {
      ok: false as const,
      error: error.code === "23505" ? "A field with that key already exists." : error.message,
    };
  }
  revalidateAll();
  return { ok: true as const };
}
