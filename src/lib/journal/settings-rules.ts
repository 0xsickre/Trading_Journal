/**
 * The rules Settings enforces, as pure functions.
 *
 * Every one of these decides whether a write may happen, and every one of them
 * used to live inline in a server action where nothing could test it. Kept
 * free of Supabase and of `server-only` so the tests call them with the exact
 * shapes the actions pass, and so a client component can show the same answer
 * before the round trip.
 */

import {
  COLUMN_BACKED_CATEGORY_KEYS,
  MERGED_CATEGORY_LISTS,
} from "./column-backed-fields";
import { slugifyFieldKey } from "./field-def-types";
import { parseImportNumber } from "./import-number";
import { isListBuiltIn, type FieldShape } from "./option-usage";
import { RESERVED_KEYS } from "./reserved-keys";

// --- Protected categories (A2) ----------------------------------------------

/**
 * The option lists the seed wires to a COLUMN on the trade.
 *
 * Written out rather than derived from the field definitions alone, because a
 * definition row can be missing — an account seeded before the column-backed
 * categories existed, or a row the trader managed to remove — and the list is
 * still the only source of its column's dropdown. Losing the row must not be
 * what makes the list deletable.
 */
export const SEEDED_COLUMN_LISTS: ReadonlySet<string> = new Set([
  "technical_tag",
  "exit_reason",
  "mistake",
  "emotion",
  "discipline",
  "miss_reason",
]);

/** A field definition as far as protection needs it. */
export type DefShape = { key: string; list_key: string | null };

/**
 * Why a category may not be deleted or reshaped, or null when it may.
 *
 * `builtInFields` is what `getAllFormFields([])` returns — the hardcoded
 * fields only. That call alone was the whole check before, and with no
 * definitions merged in it knows one list, `risk_pct`; Technical tags, Mistake,
 * Emotion, Discipline, Exit reason and Miss reason could all be deleted,
 * leaving their columns with an empty dropdown on every trade from then on.
 */
export function listProtection(
  listKey: string,
  defs: readonly DefShape[],
  builtInFields: readonly FieldShape[],
): string | null {
  if (isListBuiltIn(builtInFields, listKey))
    return "A built-in field reads this category.";
  if (SEEDED_COLUMN_LISTS.has(listKey))
    return "This category feeds a built-in trade column.";
  for (const lists of Object.values(MERGED_CATEGORY_LISTS))
    if (lists.includes(listKey)) return "This category feeds a built-in trade column.";
  if (defs.some((d) => d.list_key === listKey && COLUMN_BACKED_CATEGORY_KEYS.has(d.key)))
    return "This category feeds a built-in trade column.";
  return null;
}

/**
 * Whether the category's picker may switch between one tag and several (A3).
 *
 * A column-backed category stores an ARRAY (or a single value) in a typed
 * column, so switching its picker would write the wrong shape into it. A
 * custom category keeps its values in `custom`, where the shape can change
 * only while no trade has recorded one — old trades would otherwise hold a
 * string where the form now expects a list, or the other way round.
 */
export function selectionChangeRefusal(
  listKey: string,
  defs: readonly DefShape[],
  tradesUsing: number,
): string | null {
  if (
    SEEDED_COLUMN_LISTS.has(listKey) ||
    defs.some((d) => d.list_key === listKey && COLUMN_BACKED_CATEGORY_KEYS.has(d.key))
  )
    return "How this category is picked is fixed: it is stored in a trade column.";
  if (tradesUsing < 0)
    return "Could not check whether trades use this category — try again.";
  if (tradesUsing > 0)
    return `${tradesUsing} ${tradesUsing === 1 ? "trade already uses" : "trades already use"} this category, so how it is picked can no longer change.`;
  return null;
}

// --- Lists that write to the same place (A5, A6) -----------------------------

/**
 * Every list whose values land in the same trade field as `listKey`'s.
 *
 * Emotion and Discipline both feed `psychology_tags`; any other list feeds only
 * its own field. Used where two lists holding the same text would collide:
 * a rename onto a name the sibling already has, and a move between lists.
 */
export function siblingLists(listKey: string): string[] {
  for (const lists of Object.values(MERGED_CATEGORY_LISTS))
    if (lists.includes(listKey)) return [...lists];
  return [listKey];
}

/**
 * Whether renaming to `next` would merge two different tags into one (A5).
 *
 * A trade stores a tag as text, so a rename onto a name that already exists in
 * the same list — or in a sibling list feeding the same column — makes the two
 * indistinguishable on every trade that held either. Compared case-blind: "Fomo"
 * and "FOMO" would read as one tag to anyone looking at the trade.
 */
export function renameCollision(
  next: string,
  currentValue: string,
  existingValues: readonly string[],
): string | null {
  const n = next.trim().toLowerCase();
  if (n === currentValue.trim().toLowerCase()) return null;
  return existingValues.some((v) => v.trim().toLowerCase() === n)
    ? `"${next.trim()}" already exists in this category — pick another name.`
    : null;
}

/**
 * Whether a tag may move to another category (A6).
 *
 * The tag keeps its text, so trades that hold it stay attached only if the
 * destination feeds the SAME field. Between Emotion and Discipline that is
 * true; anywhere else the trades would keep a value their field no longer
 * offers, so it is allowed only while no trade uses the tag.
 */
export function moveRefusal(
  fromListKey: string,
  toListKey: string,
  tradesUsing: number,
  toProtected: boolean,
): string | null {
  if (fromListKey === toListKey) return "The tag is already in that category.";
  if (siblingLists(fromListKey).includes(toListKey)) return null;
  if (toProtected)
    return "That category feeds a built-in trade column — add the tag there instead of moving one in.";
  if (tradesUsing < 0) return "Could not check whether trades use this tag — try again.";
  if (tradesUsing > 0)
    return `${tradesUsing} ${tradesUsing === 1 ? "trade uses" : "trades use"} this tag. Moving it would leave ${tradesUsing === 1 ? "it" : "them"} holding a value their category no longer offers.`;
  return null;
}

// --- Keys for new categories (A7) --------------------------------------------

/** Mirrors the CHECK on `tj_field_defs.key` and `addFieldDef`. */
export const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

/**
 * The key a new category gets, or the reason there is none.
 *
 * The same derivation `addFieldDef` applies, done BEFORE anything is inserted.
 * `addList` used its own looser one, so a label like "Čekirano" or "1st setup"
 * produced a list whose key the field definition then refused — and the list
 * stayed behind with no field, blocking every retry with "already exists".
 */
export function newCategoryKey(
  label: string,
  existingKeys: readonly string[],
): { ok: true; key: string } | { ok: false; error: string } {
  const clean = label.trim();
  if (!clean) return { ok: false, error: "The name cannot be empty." };
  if (!/[a-z0-9]/i.test(clean.normalize("NFD").replace(/[̀-ͯ]/g, "")))
    return { ok: false, error: "The name must contain at least one letter or digit." };
  const key = slugifyFieldKey(clean);
  if (!CATEGORY_KEY_RE.test(key))
    return { ok: false, error: "The name cannot be turned into a valid key — try a simpler one." };
  if (RESERVED_KEYS.has(key))
    return { ok: false, error: `"${clean}" is taken by a built-in trade field — pick another name.` };
  if (existingKeys.includes(key))
    return { ok: false, error: "A category with that name already exists." };
  return { ok: true, key };
}

// --- Postgres array literal (A4) ---------------------------------------------

/**
 * A text[] literal for `cs` (array contains), with every element quoted.
 *
 * PostgREST's `.contains(column, ["a,b"])` builds `{a,b}`, which Postgres reads
 * as TWO elements — so a tag with a comma in it never matched its own trades
 * and its usage read 0. Quoting and escaping `"` and `\` keeps it one element.
 */
export function pgTextArrayLiteral(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

// --- Tracker retire (A9) -----------------------------------------------------

/**
 * Whether retiring a tracker rule may delete it outright.
 *
 * Only a rule created TODAY and never answered. Any older rule was live on past
 * days — as an unanswered box it already counted against them — so deleting it
 * would remove it from those days' denominators and raise their scores after
 * the fact. Those rules are retired with `deleted_at` instead.
 */
export function trackerRuleMayHardDelete(input: {
  createdDay: string;
  today: string;
  answered: boolean;
  mandatory: boolean;
}): boolean {
  return !input.mandatory && !input.answered && input.createdDay === input.today;
}

// --- Numbers typed in Settings (A10) -----------------------------------------

/**
 * A number typed into a Settings field, or the reason it was refused.
 *
 * `Number("10.000")` is 10 and `Number("")` is 0, so balances and FTMO limits
 * used to save as a different value — or as zero — with no word. The import
 * parser reads `10.000`, `10,000` and `-37,50` the way a trader means them and
 * refuses what it cannot read; empty is "no value", which the caller decides
 * about (`allowEmpty`).
 */
export function parseSettingsNumber(
  raw: string,
  opts: { min?: number; max?: number; allowEmpty?: boolean; integer?: boolean } = {},
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw.trim() === "") {
    return opts.allowEmpty ? { ok: true, value: null } : { ok: false, error: "Required." };
  }
  const text = raw.trim();
  // A zero in front decides the separator on its own: nothing groups thousands
  // onto a zero, so "0.001" and "0,001" are both a thousandth. Both used to be
  // refused — one as unreadable, the other as ambiguous, with the advice to
  // "write 0001 or 0.001" — and a tick size of 0.001 could not be saved at all.
  const zeroLed = /^([+-]?)0[.,](\d+)$/.exec(text);
  // "25.000" is twenty-five thousand to half the world and twenty-five to the
  // other half, and the import parser (rightly, for prices) reads it as 25.
  // On a balance or a fee that guess is a thousandfold error, so it is refused
  // with the two unambiguous ways to write it.
  if (!zeroLed && /^[+-]?\d{1,3}[.,]\d{3}$/.test(text))
    return { ok: false, error: `Ambiguous — write ${text.replace(/[.,]/, "")} or ${text.replace(",", ".").replace(/0+$/, "").replace(/\.$/, ".0")}.` };
  const n = zeroLed ? Number(`${zeroLed[1]}0.${zeroLed[2]}`) : parseImportNumber(raw);
  if (n == null || !Number.isFinite(n)) return { ok: false, error: "Not a number." };
  if (opts.integer && !Number.isInteger(n)) return { ok: false, error: "Must be a whole number." };
  if (opts.min != null && n < opts.min) return { ok: false, error: `Must be at least ${opts.min}.` };
  if (opts.max != null && n > opts.max) return { ok: false, error: `Must be at most ${opts.max}.` };
  return { ok: true, value: n };
}
