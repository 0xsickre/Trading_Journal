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
  /** Jedan broj iz kratkog raspona, biran klikom. Cifre, ne zvezdice — vidi `NumberChoice`. */
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
        // `technical_tags` is declared here rather than in a group of its own
        // because it IS one of these: a tags field over the `technical_tag`
        // category, the same shape as every category the trader adds in
        // Settings. It kept a hardcoded "Setup" heading only for historical
        // reasons, and that heading was one of the four nobody could edit.
        //
        // Everything else in this group is appended by `buildFormTabs` from
        // `tj_field_defs`, in the trader's own `sort_order`.
        id: TAGS_GROUP_ID,
        fields: [
          // `setup_grade` USED TO BE ASKED HERE, as a dropdown of A+/A/B/C.
          // It is gone because it was answered after the outcome was known —
          // a loser remembered as a B, a winner as an A+ — and it is the
          // dimension the dashboard groups by default, so the grade explained
          // performance with a label partly taken from performance.
          //
          // It is now DERIVED from the playbook criteria ticked below, in
          // `setup-score.ts`. The column survives to carry the trades graded by
          // hand before this, and nothing writes it any more.
          {
            name: "technical_tags",
            label: "Technical Tags",
            type: "tags",
            listKey: "technical_tag",
            colSpan: 2,
            placeholder: "Sweep, MSS, FVG, OB, OTE, SMT…",
          },
        ],
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
      {
        // Rendered only for a missed setup, right above the lifecycle buttons
        // that produced that state — the reason belongs next to the act.
        id: "plan_review",
        title: "Missed setup",
        description: "Why the plan was never opened.",
        fields: [
          {
            name: "miss_reason",
            label: "Miss Reason",
            type: "select",
            listKey: "miss_reason",
          },
        ],
      },
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
          { name: "exit_reason", label: "Exit Reason", type: "select", listKey: "exit_reason" },
          {
            // Rezultat prepisan sa brokerovog izvoda, umesto izvedenog iz cena.
            //
            // Postoji zato što je broj koji broker prikazuje VEĆ konvertovan u
            // valutu naloga, po kursu iz trenutka izvršenja koji se ne može ni
            // saznati ni ponoviti. Za USDJPY, GER40 ili FDAX na dolarskom nalogu
            // to je jedini način da rezultat bude tačan.
            //
            // Prazno = računaj iz cena, kao i do sada. Popunjeno = ovaj broj je
            // BRUTO; provizije i swap se i dalje oduzimaju posebno, jer ih i
            // brokerov izvod vodi kao zasebne kolone.
            //
            // R se NE menja: i dalje se meri iz cena, pa je i sa upisanim
            // rezultatom R-multiple i dalje uporediv između trejdova.
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
        // `mistake` moved up out of Advanced. Of everything on this tab it is
        // among the two or three fields the journal exists to collect; behind a
        // disclosure triangle it was the one field nobody fills.
        id: "psychology_notes",
        title: "Review",
        fields: [
          {
            // Više grešaka po trejdu. Jedan loš trejd retko ima jednu: ušlo se
            // kasno JER se jurilo, pa se pomerio stop. Izbor između njih baca
            // baš ono zbog čega polje postoji — koja se greška PONAVLJA.
            //
            // „None" se više ne nudi (deaktivirano u migraciji): prazan izbor
            // već znači „bez greške", a chip „None" pored chipa „Late entry" je
            // protivrečnost koju picker ne bi mogao da spreči.
            name: "mistake",
            label: "Mistake",
            type: "tags",
            listKey: "mistake",
            colSpan: 2,
            placeholder: "Late entry, Moved stop…",
          },
          {
            // Koliko je trejd dobro ODIGRAN — ne koliko je bio profitabilan.
            // `setup_grade` je kvalitet setapa; ovo je jedino polje koje sudi
            // izvršenju, i sudi mu POSLE izlaska. Gubitnik odigran po planu
            // zaslužuje 5.
            //
            // Config-driven: nema ponašanja, jedna vrednost, jedna grupa. Zato
            // besplatno dobija dozvolu za upis (`positionFieldNames`), koerciju
            // (`numericFieldNames`) i mesto u mentor paketu po redosledu forme.
            name: "execution_rating",
            label: "Execution rating",
            type: "rating",
          },
          {
            name: "psychology_tags",
            label: "Psychology tags",
            type: "tags",
            listKeys: ["emotion", "discipline"],
            colSpan: 2,
            placeholder: "FOMO, Followed plan, Moved stop…",
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
    colSpan: def.field_type === "textarea" || def.field_type === "tags" ? 2 : 1,
    custom: true,
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
): FormTab[] {
  const extra = [...defs]
    .filter((d) => phase == null || fieldAppliesToPhase(d.show_phase, phase))
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))
    .map(toFieldConfig);

  return BASE_TABS.map((tab) => ({
    ...tab,
    groups: tab.groups
      .map((group) =>
        group.id === TAGS_GROUP_ID
          ? { ...group, fields: [...group.fields, ...extra] }
          : group,
      )
      // A group with no fields is a heading over nothing — and the categories
      // group has no heading at all, so an empty one would be a blank gap.
      .filter((group) => group.fields.length > 0),
  }));
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
