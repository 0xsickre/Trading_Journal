// The fields a trade carries, for the readers that enumerate them.
//
// There is no trade FORM behind this any more (phase P, 14.10.2026): a trade
// comes in through the TopstepX import and is reviewed on one page
// (`/trades/[id]`, `components/journal/trade-page.tsx`), which writes through
// `saveTradeReview`. What is left here is the inventory the CSV export, the
// report dimensions, the grid, Settings' list protection and the mentor pack
// read — the fixed fields first, then the trader's own categories from
// `tj_field_defs`.
//
// The plan-before-entry fields left with the form: Position Size, Scale-out
// plan, Invalidation and Time stop were never filled once trades came in by
// import (0 of 3 on 14.10.2026), and their columns stay in the database.
//
// Values for def-driven fields are stored in `tj_positions.custom` — see
// lib/journal/field-values.ts, which is the only place that knows that.

import {
  isColumnBackedCategory,
  MERGED_CATEGORY_LISTS,
} from "./column-backed-fields";
import type { FieldDef } from "./field-def-types";

export type FieldType =
  | "select"
  | "instrument"
  | "number"
  | "text"
  | "textarea"
  | "url"
  | "tags"
  | "rating"
  | "computed";

export type FieldConfig = {
  name: string; // tj_positions column, or a key inside `custom`
  label: string;
  type: FieldType;
  listKey?: string; // for select / tags -> primary option list
  listKeys?: string[]; // for tags -> merge suggestions from multiple lists
  colSpan?: 1 | 2;
  /** True when the value lives in `custom` rather than in its own column. */
  custom?: boolean;
};

/** The fixed fields, in the order the trade page asks them. */
const BASE_FIELDS: FieldConfig[] = [
  { name: "instrument", label: "Instrument", type: "instrument" },
  // The planned entry of a missed setup; on a traded one the import writes the fill.
  { name: "entry_price", label: "Planned Entry Price", type: "number" },
  // The ORIGINAL stop, off the recording when the platform's was moved (phase O).
  { name: "stop_price", label: "Stop Price", type: "number" },
  { name: "direction", label: "Direction", type: "computed" },
  { name: "target_price", label: "Target Price", type: "number" },
  { name: "planned_rr", label: "Planned R:R", type: "computed" },
  // What was said before the click, off the recording.
  { name: "thesis", label: "Thesis", type: "textarea", colSpan: 2 },
  // A result transcribed off the broker's statement; for futures the view
  // computes it from the fills and this stays empty.
  { name: "gross_pnl_override", label: "Actual Gross P&L (broker)", type: "number" },
  // Written the next morning from the exchange's candles in R2 for futures.
  { name: "max_drawdown_price", label: "MAE Price (max adverse)", type: "number" },
  { name: "max_profit_price", label: "MFE Price (max favorable)", type: "number" },
  // How well the trade was PLAYED, A/B/C on the page (A=5, B=3, C=1).
  { name: "execution_rating", label: "Execution rating", type: "rating" },
  { name: "trade_journal_notes", label: "Trade note", type: "textarea", colSpan: 2 },
];

function toFieldConfig(def: FieldDef): FieldConfig {
  return {
    name: def.key,
    label: def.label,
    type: def.field_type,
    listKey: def.list_key ?? undefined,
    // The picker merges several lists for the one category that needs it.
    listKeys: MERGED_CATEGORY_LISTS[def.key]
      ? [...MERGED_CATEGORY_LISTS[def.key]]
      : undefined,
    colSpan: def.field_type === "textarea" ? 2 : 1,
    // `false` for the five that own a real column on `tj_positions`. A
    // definition normally means "the value lives in the `custom` bag", but
    // `fieldValue` reads a column BEFORE the bag — so writing one of these to
    // the bag would make it permanently invisible. See `column-backed-fields.ts`.
    custom: !isColumnBackedCategory(def.key),
  };
}

/**
 * Every distinct field a trade carries: the fixed ones, then every category in
 * the trader's `sort_order`, across every phase — the export, the report
 * dimensions and the mentor pack describe trades of every phase at once.
 */
export function getAllFormFields(defs: readonly FieldDef[] = []): FieldConfig[] {
  const categories = [...defs]
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))
    .map(toFieldConfig);
  const seen = new Set<string>();
  return [...BASE_FIELDS, ...categories].filter((f) => !seen.has(f.name) && seen.add(f.name));
}

/** Field names a trade row carries. */
export function positionFieldNames(defs: readonly FieldDef[] = []): string[] {
  return getAllFormFields(defs).map((f) => f.name);
}

export function numericFieldNames(defs: readonly FieldDef[] = []): Set<string> {
  return new Set(
    getAllFormFields(defs)
      // `rating` is numeric too — its buttons write a number into a `smallint`
      // column. Left out, it would fall through to the string branch of
      // `buildPositionPatch` and send "4" to Postgres as text.
      .filter((f) => f.type === "number" || f.type === "rating")
      .map((f) => f.name),
  );
}

export function arrayFieldNames(defs: readonly FieldDef[] = []): Set<string> {
  return new Set(
    getAllFormFields(defs)
      .filter((f) => f.type === "tags")
      .map((f) => f.name),
  );
}

/** Keys whose values are stored in `custom` rather than in a column. */
export function customFieldNames(defs: readonly FieldDef[] = []): Set<string> {
  return new Set(
    getAllFormFields(defs)
      .filter((f) => f.custom)
      .map((f) => f.name),
  );
}
