/**
 * What a dropdown option is holding, so the delete dialog can name it first.
 *
 * "Delete this option?" is a question nobody can answer without knowing whether
 * it costs nothing or costs ten trades. The count is what turns the
 * confirmation from a reflex into a decision — the same argument, and the same
 * shape, as `account-usage.ts`.
 *
 * Deliberately free of `server-only` and of any Supabase import: the dialog is
 * a client component and needs the type and the predicate. The read that
 * produces the number lives in `option-usage-queries.ts`, which is the half
 * that must not cross to the browser.
 */
export type OptionUsage = {
  /** Trades carrying this option's value, across every field fed by its list. */
  trades: number;
};

export const EMPTY_OPTION_USAGE: OptionUsage = { trades: 0 };

/** The shape used when the count could not be read at all. */
export const UNKNOWN_OPTION_USAGE: OptionUsage = { trades: -1 };

/**
 * True when changing this option would touch nothing.
 *
 * A negative count is the sentinel for a read that failed, and it answers
 * `false` here on purpose: "we could not find out" must take the same careful
 * path as "there is something here", never the path that deletes on one click.
 */
export function optionUsageIsEmpty(u: OptionUsage): boolean {
  return u.trades === 0;
}

/** True when the count failed to read. */
export function optionUsageIsUnknown(u: OptionUsage): boolean {
  return u.trades < 0;
}

/**
 * Where a list's values actually land on a trade.
 *
 * A list is never read directly by the trade table — it feeds one or more
 * FIELDS, and each of those decides its own storage. Counting usage, and
 * cascading a rename, both need the same answer to "which columns and which
 * jsonb keys could be carrying this value", so the map is computed once here
 * rather than guessed twice.
 */
export type OptionFieldTarget = {
  /** Column name on `tj_positions`, or the key inside the `custom` bag. */
  key: string;
  /** True when the value lives in `custom` rather than in its own column. */
  custom: boolean;
  /** True for tag fields, whose value is an array rather than a scalar. */
  array: boolean;
};

type FieldShape = {
  name: string;
  type: string;
  listKey?: string;
  listKeys?: string[];
  custom?: boolean;
};

/**
 * Fields fed by `listKey`, from the form's own field registry.
 *
 * Built from `getAllFormFields` rather than from a hardcoded table: that
 * function already merges the built-in fields with the trader's own
 * `tj_field_defs`, so a list attached to a custom field is found without this
 * module knowing custom fields exist. A hardcoded table would silently miss
 * them, and the miss would look like "this option is unused".
 *
 * `listKeys` is read alongside `listKey` because a tag field can merge
 * suggestions from several lists — psychology draws from `emotion` and
 * `discipline` at once, and an option from either ends up in the same column.
 */
export function optionFieldTargets(
  fields: readonly FieldShape[],
  listKey: string,
): OptionFieldTarget[] {
  const out: OptionFieldTarget[] = [];
  for (const f of fields) {
    const feeds = f.listKey === listKey || (f.listKeys ?? []).includes(listKey);
    if (!feeds) continue;
    out.push({
      key: f.name,
      custom: f.custom === true,
      array: f.type === "tags",
    });
  }
  return out;
}
