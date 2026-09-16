// Declarative config for the trade entry form.
//
// Two halves, and the split is deliberate:
//
//   STRUCTURE lives here, in code. Tabs, the progressive risk plan, the
//   missed-setup review, the outcome block — those are BEHAVIOUR. `trade-form`
//   branches on `risk_plan`, `plan_review` and `psychology_notes` by name, and
//   the metrics panel reads `entry_price` / `stop_price` / `risk_pct` literally.
//   Making those data would not make the form configurable, it would only move
//   the hardcoding somewhere the type checker cannot see it.
//
//   CONTENT of the methodology groups comes from `tj_field_defs`. Adding "Was
//   this an A+ session?" is a form action in Settings, not a migration, and the
//   new field shows up as a report dimension on its own.
//
// Values for def-driven fields are stored in `tj_positions.custom` — see
// lib/journal/field-values.ts, which is the only place that knows that.

import {
  isColumnBackedCategory,
  MERGED_CATEGORY_LISTS,
} from "./column-backed-fields";
import {
  fieldAppliesToPhase,
  type FieldDef,
  type FieldDefPhase,
} from "./field-def-types";

export type FieldType =
  | "select"
  | "instrument"
  | "number"
  | "text"
  | "textarea"
  | "url"
  | "tags"
  | "rating"
  /** One number from a short range, picked by clicking. Digits, not stars — see `NumberChoice`. */
  | "days"
  | "computed";

export type FieldConfig = {
  name: string; // tj_positions column, or a key inside `custom`
  label: string;
  type: FieldType;
  listKey?: string; // for select / tags -> primary option list
  listKeys?: string[]; // for tags -> merge suggestions from multiple lists
  placeholder?: string;
  colSpan?: 1 | 2; // grid span (of 2)
  /** True when the value lives in `custom` rather than in its own column. */
  custom?: boolean;
};

export type FormGroup = {
  id: string;
  /**
   * Optional, and absent for exactly one group: the trader's own categories.
   *
   * The structural groups below name a STAGE of the form — the risk plan, the
   * thesis, how it exited — and those names come with behaviour the group
   * cannot be understood without. A heading over the trader's categories names
   * nothing: each category already carries its own label, and the four fixed
   * headings that used to sit there ("Setup", "Context", two "Advanced") were
   * the only structure on this screen the trader could not rename, reorder or
   * delete. They are gone; the fields stand on their own.
   */
  title?: string;
  description?: string;
  fields: FieldConfig[];
};

export type FormTab = {
  id: "plan" | "execution";
  title: string;
  description?: string;
  groups: FormGroup[];
};

/**
 * The one group the trader's categories land in.
 *
 * Named rather than inlined because `buildFormTabs` has to find it to append to
 * it, and the trade form checks the same id when it decides whether a group
 * gets a heading.
 */
export const TAGS_GROUP_ID = "tags";

/**
 * The form skeleton. The categories group starts with `technical_tags` and is
 * filled from the field defs by `buildFormTabs`; every other group is fixed.
 */
const BASE_TABS: FormTab[] = [
  {
    id: "plan",
    title: "Plan & Setup",
    description: "Fill this in before entering the trade.",
    groups: [
      {
        id: "meta",
        title: "Trade",
        description: "What, on which account, at which phase.",
        fields: [
          { name: "instrument", label: "Instrument", type: "instrument" },
        ],
      },
      {
        // Field order follows the ORDER OF CALCULATION: each computed field sits
        // immediately after the inputs it falls out of. Entry and stop give the
        // direction; risk % and the stop distance give the size; the target
        // gives the R:R. Reading top to bottom is reading the arithmetic.
        id: "risk_plan",
        title: "Risk and plan",
        fields: [
          { name: "entry_price", label: "Planned Entry Price", type: "number" },
          { name: "stop_price", label: "Stop Price", type: "number" },
          {
            name: "direction",
            label: "Direction",
            type: "computed",
            placeholder: "Auto from entry vs stop",
          },
          { name: "risk_pct", label: "Risk %", type: "select", listKey: "risk_pct" },
          {
            name: "position_size",
            label: "Position Size",
            type: "computed",
            placeholder: "Auto from risk % and stop",
          },
          { name: "target_price", label: "Target Price", type: "number" },
          {
            name: "planned_rr",
            label: "Planned R:R",
            type: "computed",
            placeholder: "Auto from entry / stop / target",
          },
          {
            // Sits with the target because it is part of the same decision: the
            // target says where you are going, this says how much comes off on
            // the way. Revealed with `planned_rr`, so it appears only once
            // there is a target to scale out toward.
            name: "scale_out_plan",
            label: "Scale-out plan",
            type: "textarea",
            colSpan: 2,
            placeholder: "50% at 1R, rest to target…",
          },
        ],
      },
      {
        // The three swing fields stand as their own group rather than trailing
        // the risk plan.
        //
        // They used to be appended to `risk_plan`, and that had a concrete bug:
        // `riskPlanFieldVisible` falls through to `true` for any name it does
        // not know, so all three showed on a COMPLETELY BLANK form — Entry
        // Price, then three large textareas below it. The progressive reveal
        // exists to ask one decision at a time, and the three fields defeated
        // it. As a group they are gated once, on entry and stop.
        //
        // The heading also earns its place: the numbers above are what the
        // trade IS, these are why it exists. Reading them under "Risk and plan"
        // filed the reasoning as an appendix to the arithmetic.
        id: "thesis",
        title: "Why this trade",
        description: "The part the numbers cannot answer.",
        fields: [
          {
            name: "thesis",
            label: "Thesis",
            type: "textarea",
            colSpan: 2,
            placeholder: "Why I am in this, in one line…",
          },
          {
            // The one field a daily check can actually check AGAINST. Without
            // it, "is the thesis still good?" has no referent and decays into
            // reading the P&L, which is the question it exists to replace.
            name: "invalidation",
            label: "Invalidation — what would prove me wrong",
            type: "textarea",
            colSpan: 2,
            placeholder: "The level, the close, the event that ends this…",
          },
          {
            // Five buttons, not a free number: holds longer than a week are no
            // longer taken, so anything the input could accept beyond 5 was a
            // typo waiting to happen. The database now refuses those too.
            //
            // The hint names where the number does its work. Nothing happens on
            // THIS screen when you set it, and both effects live on other pages
            // — without saying so the field reads as decoration.
            name: "time_stop_days",
            label: "Time stop (days)",
            type: "days",
            placeholder: "Daily check-in shows „day 3 of N\" and warns past it",
          },
        ],
      },
      {
        // The trader's own categories, flat and unheaded — `TAGS_GROUP_ID`.
        //
        // Declared EMPTY. Every category in it, `technical_tags` included, now
        // comes from `tj_field_defs` through `buildFormTabs`, in the trader's
        // own order. It used to hold `technical_tags` as a hardcoded field, and
        // that is exactly what made that one category unconfigurable: no phase,
        // no single/multi, nothing in Settings but a rename.
        id: TAGS_GROUP_ID,
        fields: [],
      },
      // The `notes` group stood here: one `trade_journal_notes` textarea,
      // placeholder "Why I am entering, stop and target logic…", the same
      // column also rendered on Execution.
      //
      // It is gone from the PLAN tab because it asked the same question as
      // `thesis` two groups above it. Two free-text boxes for "why", filled
      // one at a time, meant no report could tell which one held the reasoning.
      // `thesis` wins that job: it is the field the daily position check-in
      // reads. The note keeps the Execution tab, where the same column means
      // the lesson AFTER the outcome — one question, one place.
    ],
  },
  {
    id: "execution",
    title: "Execution & Review",
    description: "Fill this in when you close or review the trade.",
    groups: [
      {
        // No manual Win/Loss/Breakeven field: the outcome falls out of net P&L
        // and the account's breakeven band via `classifyOutcome`, which is what
        // every statistic already reads. `exit_reason` stays because the REASON
        // for the exit — target, stop, time — is not in the price.
        id: "outcome",
        title: "How it exited",
        fields: [
          {
            // A result transcribed off the broker's statement, instead of derived
            // from prices.
            //
            // It exists because the number a broker shows is ALREADY converted
            // into the account's currency, at the rate in force at execution,
            // which can be neither recovered nor reproduced. For USDJPY, GER40
            // or FDAX on a dollar account this is the only way the result is
            // correct.
            //
            // Empty = compute from prices, as before. Filled in = this number is
            // GROSS; commissions and swap are still subtracted separately,
            // because the broker's statement keeps them as separate columns too.
            //
            // R does NOT change: it is still measured from prices, so even with
            // a transcribed result the R-multiple stays comparable across
            // trades.
            name: "gross_pnl_override",
            label: "Actual Gross P&L (broker)",
            type: "number",
            placeholder: "Leave empty to compute from prices",
          },
          {
            name: "max_drawdown_price",
            label: "MAE Price (max adverse)",
            type: "number",
            placeholder: "Worst price against the position",
          },
          {
            name: "max_profit_price",
            label: "MFE Price (max favorable)",
            type: "number",
            placeholder: "Best price in favour of the position",
          },
        ],
      },
      {
        // The trader's own categories again, on the review side.
        //
        // Empty like its twin on the plan tab. Which of the two a category
        // lands in follows from its PHASE and nothing else: `active` means the
        // question is answerable only once you are in the trade — Exit Reason,
        // Mistake, Psychology — and that is a review question, so it is asked
        // on the review tab. See `tabForPhase`.
        id: TAGS_GROUP_ID,
        fields: [],
      },
      {
        // What is LEFT here after `mistake` and `psychology_tags` became
        // ordinary categories: the execution rating and the note. Both are
        // judgements on the trade rather than tags drawn from a list, which is
        // why neither followed them out.
        id: "psychology_notes",
        title: "Review",
        fields: [
          {
            // How well the trade was PLAYED — not how profitable it was.
            // `setup_grade` is the quality of the setup; this is the only field
            // that judges execution, and it judges it AFTER the exit. A loser
            // played to plan deserves a 5.
            //
            // Config-driven: no behaviour, one value, one group. So it gets
            // write permission (`positionFieldNames`), coercion
            // (`numericFieldNames`) and a place in the mentor pack in form
            // order, all for free.
            name: "execution_rating",
            label: "Execution rating",
            type: "rating",
          },
          {
            name: "trade_journal_notes",
            label: "Trade note",
            type: "textarea",
            colSpan: 2,
            placeholder: "Why the entry, stop/target logic, the lesson…",
          },
        ],
      },
    ],
  },
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
    // Categories are one column each, so the group reads as an even grid. A
    // textarea is the exception and keeps both: it is prose, and half a row is
    // not enough of it to be worth writing in.
    colSpan: def.field_type === "textarea" ? 2 : 1,
    // `false` for the five that own a real column on `tj_positions`. A
    // definition normally means "the value lives in the `custom` bag", but
    // `fieldValue` reads a column BEFORE the bag — so writing one of these to
    // the bag would make it permanently invisible. See `column-backed-fields.ts`.
    custom: !isColumnBackedCategory(def.key),
  };
}

/**
 * The form config for a given set of user-defined categories.
 *
 * Every definition lands in one place — the flat categories group — in the
 * trader's own `sort_order`. There is no longer a group to name: `group_id` and
 * the four headings it chose between are gone, and a definition can no longer
 * be silently dropped for pointing at a group that does not exist.
 *
 * `phase` is the trade's own lifecycle state, and it filters. A category set to
 * "only on a missed setup" is not rendered disabled or greyed on a live trade —
 * it is not there, the same way `plan_review` and `thesis` are simply absent
 * when they do not apply. Omitting the argument shows everything, which is what
 * the readers want: the CSV export, the report dimensions and the mentor pack
 * all describe trades across every phase at once.
 */
export function buildFormTabs(
  defs: readonly FieldDef[] = [],
  phase?: Exclude<FieldDefPhase, "always">,
  categoryOrder?: Readonly<Record<string, number>>,
): FormTab[] {
  const applicable = [...defs]
    .filter((d) => phase == null || fieldAppliesToPhase(d.show_phase, phase))
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));

  const extraFor = (tabId: FormTab["id"]) =>
    applicable.filter((d) => tabForPhase(d.show_phase) === tabId).map(toFieldConfig);

  return BASE_TABS.map((tab) => ({
    ...tab,
    groups: tab.groups
      .map((group) =>
        group.id === TAGS_GROUP_ID
          ? {
              ...group,
              fields: orderCategories([...group.fields, ...extraFor(tab.id)], categoryOrder),
            }
          : group,
      )
      // A group with no fields is a heading over nothing — and the categories
      // group has no heading at all, so an empty one would be a blank gap.
      .filter((group) => group.fields.length > 0),
  }));
}

/**
 * Which tab a category is asked on, from its phase alone.
 *
 * `active` is the only one that moves. It means "answerable only once you are
 * in the trade" — Exit Reason, Mistake, Psychology — and those are review
 * questions, so they belong beside the realized numbers on Execution & Review.
 * Everything else is asked while the trade is still being set up.
 *
 * This restores where those three sat before they became ordinary categories:
 * `exit_reason` in the outcome group, `mistake` and `psychology_tags` beside
 * the review notes. Without it every category landed on Plan & Setup, and the
 * review tab asked for none of the things you review.
 *
 * A category is never on BOTH tabs. Two inputs bound to one value is a way to
 * type into one and watch the other, and `always` categories are asked at plan
 * time because that is when they are decided.
 */
function tabForPhase(showPhase: FieldDefPhase): FormTab["id"] {
  return showPhase === "active" ? "execution" : "plan";
}

/**
 * The categories group, in the order the trader dragged them into.
 *
 * Ordered by the CATEGORY rather than by the field, and that is the whole
 * point. `technical_tags` is declared in `BASE_TABS` rather than in
 * `tj_field_defs`, so it has no field ordinal of its own — it used to be
 * pinned at the top for that reason alone, the one row in the group that could
 * not be moved. The category behind it is an ordinary row with an ordinary
 * `sort_order`, so keying off that puts every category on the same footing.
 *
 * Without `categoryOrder` nothing is reordered: the readers that call this to
 * enumerate fields — the CSV export, the report dimensions, the save
 * allowlist — care about the SET, not the sequence, and should not pay for a
 * read they have no use for.
 *
 * A field with no `listKey` sorts last rather than first. There are none today;
 * a future one would be a plain input among the categories, and the bottom is
 * the safer place to put something this function knows nothing about.
 */
function orderCategories(
  fields: FieldConfig[],
  categoryOrder?: Readonly<Record<string, number>>,
): FieldConfig[] {
  if (!categoryOrder) return fields;
  const rank = (f: FieldConfig) =>
    f.listKey != null ? (categoryOrder[f.listKey] ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  // Index breaks ties so the sort stays stable for two categories that somehow
  // share an ordinal — the same tiebreak every ordered read in this app uses.
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => f);
}

/** Every distinct field in the form, in render order. */
export function getAllFormFields(defs: readonly FieldDef[] = []): FieldConfig[] {
  const seen = new Set<string>();
  const out: FieldConfig[] = [];
  for (const tab of buildFormTabs(defs)) {
    for (const group of tab.groups) {
      for (const field of group.fields) {
        if (seen.has(field.name)) continue;
        seen.add(field.name);
        out.push(field);
      }
    }
  }
  return out;
}

/** Field names the save path accepts. Anything else is dropped. */
export function positionFieldNames(defs: readonly FieldDef[] = []): string[] {
  return getAllFormFields(defs).map((f) => f.name);
}

export function numericFieldNames(defs: readonly FieldDef[] = []): Set<string> {
  return new Set([
    ...getAllFormFields(defs)
      // `rating` and `days` are numeric too — their buttons write a number into
      // a `smallint` column. Left out, either would fall through to the string
      // branch of `buildPositionPatch` and send "4" to Postgres as text.
      .filter((f) => f.type === "number" || f.type === "rating" || f.type === "days")
      .map((f) => f.name),
    "position_size",
  ]);
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
