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

import { FIELD_DEF_GROUPS, type FieldDef, type FieldDefGroup } from "./field-def-types";

export type FieldType =
  | "select"
  | "instrument"
  | "number"
  | "text"
  | "textarea"
  | "url"
  | "tags"
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
  title: string;
  description?: string;
  fields: FieldConfig[];
  advanced?: boolean;
};

export type FormTab = {
  id: "plan" | "execution";
  title: string;
  description?: string;
  groups: FormGroup[];
};

/**
 * The form skeleton. Methodology groups start empty and are filled from the
 * field defs by `buildFormTabs`; every other group is fixed.
 */
const BASE_TABS: FormTab[] = [
  {
    id: "plan",
    title: "Plan & Setup",
    description: "Fill this in before entering the trade.",
    groups: [
      {
        id: "meta",
        title: "Meta",
        fields: [
          { name: "instrument", label: "Instrument", type: "instrument" },
        ],
      },
      {
        id: "risk_plan",
        title: "Risk Plan",
        fields: [
          { name: "entry_price", label: "Planned Entry Price", type: "number" },
          { name: "stop_price", label: "Stop Price", type: "number" },
          {
            name: "direction",
            label: "Direction",
            type: "computed",
            placeholder: "Auto from entry vs stop",
          },
          { name: "target_price", label: "Target Price", type: "number" },
          { name: "risk_pct", label: "Risk %", type: "select", listKey: "risk_pct" },
          {
            name: "planned_rr",
            label: "Planned R:R",
            type: "computed",
            placeholder: "Auto from entry / stop / target",
          },
          {
            name: "position_size",
            label: "Position Size",
            type: "computed",
            placeholder: "Auto from risk % and stop",
          },
        ],
      },
      {
        id: "macro",
        title: "Macro (vault)",
        description: "Iz dashboard readiness matrice — smer i kvalitet ulaza.",
        fields: [],
      },
      {
        id: "setup",
        title: "Setup",
        fields: [
          { name: "setup_grade", label: "Setup Grade", type: "select", listKey: "setup_grade" },
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
      {
        id: "plan_review",
        title: "Plan review",
        description: "Za missed setup-e — razlog i beleške.",
        fields: [
          {
            name: "miss_reason",
            label: "Miss Reason",
            type: "select",
            listKey: "miss_reason",
          },
          {
            name: "trade_journal_notes",
            label: "Trade Journal Notes",
            type: "textarea",
            colSpan: 2,
            placeholder: "Zašto miss, šta bi drugačije…",
          },
        ],
      },
      {
        id: "plan_advanced",
        title: "Advanced",
        advanced: true,
        fields: [],
      },
    ],
  },
  {
    id: "execution",
    title: "Execution & Review",
    description: "Fill this in when you close or review the trade.",
    groups: [
      {
        id: "outcome",
        title: "Outcome",
        fields: [
          { name: "result", label: "Result", type: "select", listKey: "result" },
          { name: "exit_reason", label: "Exit Reason", type: "select", listKey: "exit_reason" },
          {
            name: "max_drawdown_price",
            label: "MAE Price (max adverse)",
            type: "number",
            placeholder: "Najgora cena protiv pozicije",
          },
          {
            name: "max_profit_price",
            label: "MFE Price (max favorable)",
            type: "number",
            placeholder: "Najbolja cena u korist pozicije",
          },
        ],
      },
      {
        id: "psychology_notes",
        title: "Psychology & Notes",
        fields: [
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
            label: "Trade Journal Notes",
            type: "textarea",
            colSpan: 2,
            placeholder: "Zašto ulaz, stop/target logika, lekcija…",
          },
        ],
      },
      {
        id: "execution_advanced",
        title: "Advanced",
        advanced: true,
        fields: [
          { name: "mistake", label: "Mistake", type: "select", listKey: "mistake" },
        ],
      },
    ],
  },
];

/** Structural groups a field def may be placed in — mirrors the DB CHECK. */
const DEF_GROUP_IDS: ReadonlySet<string> = new Set<string>(FIELD_DEF_GROUPS);

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
 * The form config for a given set of user-defined fields.
 *
 * Definitions are appended to their group in `sort_order`, after that group's
 * fixed fields. A def naming a group that does not exist is skipped rather than
 * creating one: the group set is closed on purpose (see FIELD_DEF_GROUPS).
 */
export function buildFormTabs(defs: readonly FieldDef[] = []): FormTab[] {
  const byGroup = new Map<FieldDefGroup, FieldConfig[]>();
  for (const def of defs) {
    if (!DEF_GROUP_IDS.has(def.group_id)) continue;
    const bucket = byGroup.get(def.group_id) ?? [];
    bucket.push(toFieldConfig(def));
    byGroup.set(def.group_id, bucket);
  }

  return BASE_TABS.map((tab) => ({
    ...tab,
    groups: tab.groups
      .map((group) => {
        const extra = byGroup.get(group.id as FieldDefGroup) ?? [];
        return extra.length > 0
          ? { ...group, fields: [...group.fields, ...extra] }
          : group;
      })
      // An advanced group with nothing in it is a disclosure triangle that
      // opens onto nothing — drop it rather than render an empty box.
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
      .filter((f) => f.type === "number")
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
