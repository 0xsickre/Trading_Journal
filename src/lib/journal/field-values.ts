/**
 * The one place that knows WHERE a trade field is stored.
 *
 * Methodology fields used to be physical columns on `tj_positions`. Recording a
 * new idea meant a migration, a form change and a registry change — so in
 * practice ideas went unrecorded. From Phase 4 on, a field is a row in
 * `tj_field_defs` and its value lives in the `custom` jsonb column.
 *
 * That move is only safe because every generic reader goes through here. Half a
 * dozen places index a trade row by a string key (the report dimensions, the
 * mentor pack, the grid filters, the CSV export, the process insight rules). If
 * any of them kept reading `row[key]` directly, moving a field into `custom`
 * would make it return `undefined` — no error, no crash, just a column that
 * quietly went blank and statistics that quietly went wrong.
 *
 * Column wins over `custom`. A real column is the stronger claim, and that
 * ordering means a leftover `custom` entry can never shadow one.
 */

/** jsonb column on `tj_positions` holding every user-defined field value. */
export const CUSTOM_FIELD_COLUMN = "custom";

type Row = Record<string, unknown>;

function customBag(row: Row): Row | null {
  const bag = row[CUSTOM_FIELD_COLUMN];
  if (bag && typeof bag === "object" && !Array.isArray(bag)) return bag as Row;
  return null;
}

/** Raw value of `key` on a trade row, wherever it is stored. */
export function fieldValue(row: Row, key: string): unknown {
  // `undefined` means "no such property"; `null` means "stored, but empty" and
  // must NOT fall through to the custom bag — a column explicitly cleared to
  // null is an answer, not a miss.
  const direct = row[key];
  if (direct !== undefined) return direct;
  return customBag(row)?.[key];
}

/** Non-empty string value, or null. What every select-style reader wants. */
export function stringFieldValue(row: Row, key: string): string | null {
  const v = fieldValue(row, key);
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Non-empty array of non-empty strings, or null. For tag fields. */
export function arrayFieldValue(row: Row, key: string): string[] | null {
  const v = fieldValue(row, key);
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x !== "");
  return out.length > 0 ? out : null;
}

/** Number value, or null. Non-finite input reads as absent, never as NaN. */
export function numberFieldValue(row: Row, key: string): number | null {
  const v = fieldValue(row, key);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Display string for exports: arrays join, null/undefined render empty. */
export function displayFieldValue(row: Row, key: string): string {
  const v = fieldValue(row, key);
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

export type FieldSplit = {
  /** Values written to their own column. */
  columns: Record<string, unknown>;
  /** Values written into the `custom` jsonb bag. */
  custom: Record<string, unknown>;
};

/**
 * Split a flat field record into column writes and custom-bag writes.
 *
 * `customKeys` comes from `tj_field_defs`, so the decision is made by the same
 * source of truth the form is built from — not by a hardcoded list that would
 * drift the first time a field is added.
 */
export function splitFieldsByStorage(
  fields: Record<string, unknown>,
  customKeys: ReadonlySet<string>,
): FieldSplit {
  const columns: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (customKeys.has(key)) custom[key] = value;
    else columns[key] = value;
  }
  return { columns, custom };
}

/**
 * Flatten a row's `custom` bag onto a plain field record.
 *
 * The edit form reads a flat `Record<string, …>`; without this the whole bag
 * arrives as one object under the key `custom`, gets dropped by the form's type
 * filter, and every custom field silently empties on save.
 */
export function flattenCustom(
  row: Row,
  into: Record<string, unknown> = {},
): Record<string, unknown> {
  const bag = customBag(row);
  if (!bag) return into;
  for (const [key, value] of Object.entries(bag)) {
    if (value == null) continue;
    into[key] = value;
  }
  return into;
}
