// Declarative config for the trade entry form. Keeps the form data-driven and
// consistent with the DB columns and the option lists.

export type FieldType =
  | "select"
  | "instrument"
  | "number"
  | "text"
  | "textarea"
  | "url"
  | "tags";

export type FieldConfig = {
  name: string; // tj_positions column
  label: string;
  type: FieldType;
  listKey?: string; // for select / tags -> primary option list
  listKeys?: string[]; // for tags -> merge suggestions from multiple lists
  placeholder?: string;
  colSpan?: 1 | 2; // grid span (of 2)
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

export const FORM_TABS: FormTab[] = [
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
          { name: "direction", label: "Direction", type: "select", listKey: "direction" },
        ],
      },
      {
        id: "setup",
        title: "Setup",
        fields: [
          { name: "htf_bias", label: "HTF Bias", type: "select", listKey: "htf_bias" },
          {
            name: "ict_entry_model",
            label: "ICT Entry Model",
            type: "select",
            listKey: "ict_entry_model",
          },
          {
            name: "confluences",
            label: "Confluences",
            type: "tags",
            listKey: "confluence",
            colSpan: 2,
            placeholder: "FVG, OB, liquidity sweep…",
          },
        ],
      },
      {
        id: "risk_plan",
        title: "Risk Plan",
        fields: [
          { name: "entry_price", label: "Planned Entry Price", type: "number" },
          { name: "stop_price", label: "Stop Price", type: "number" },
          { name: "target_price", label: "Target Price", type: "number" },
          { name: "risk_pct", label: "Risk %", type: "select", listKey: "risk_pct" },
        ],
      },
      {
        id: "plan_advanced",
        title: "Advanced",
        advanced: true,
        fields: [
          { name: "trade_type", label: "Trade Type", type: "select", listKey: "trade_type" },
          { name: "bias_tf", label: "Bias TF", type: "select", listKey: "bias_tf" },
          { name: "entry_tf", label: "Entry TF", type: "select", listKey: "entry_tf" },
          {
            name: "setup_tags",
            label: "Setup tags",
            type: "tags",
            listKeys: ["market_structure", "entry_poi"],
            colSpan: 2,
            placeholder: "Market structure, POI, PD array…",
          },
          {
            name: "premium_discount",
            label: "Premium / Discount",
            type: "select",
            listKey: "premium_discount",
          },
          {
            name: "draw_on_liquidity",
            label: "Draw on Liquidity (Target)",
            type: "select",
            listKey: "draw_on_liquidity",
          },
          { name: "ipda_range", label: "IPDA Range", type: "select", listKey: "ipda_range" },
          {
            name: "entry_trigger",
            label: "Entry Trigger",
            type: "select",
            listKey: "entry_trigger",
          },
          {
            name: "smt_divergence",
            label: "SMT Divergence",
            type: "select",
            listKey: "smt_divergence",
          },
          { name: "setup_grade", label: "Setup Grade", type: "select", listKey: "setup_grade" },
          { name: "conviction", label: "Conviction", type: "select", listKey: "conviction" },
          { name: "stop_logic", label: "Stop Logic", type: "select", listKey: "stop_logic" },
          { name: "target_logic", label: "Target Logic", type: "select", listKey: "target_logic" },
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
        id: "outcome",
        title: "Outcome",
        fields: [
          { name: "result", label: "Result", type: "select", listKey: "result" },
          { name: "exit_reason", label: "Exit Reason", type: "select", listKey: "exit_reason" },
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
            listKeys: [
              "emotion_before",
              "emotion_during",
              "emotion_after",
              "rules_followed",
              "discipline",
            ],
            colSpan: 2,
            placeholder: "FOMO, Hesitation, Followed Plan…",
          },
          {
            name: "chart_url",
            label: "TradingView Chart URL",
            type: "url",
            placeholder: "https://www.tradingview.com/x/…",
            colSpan: 2,
          },
          { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
        ],
      },
      {
        id: "execution_advanced",
        title: "Advanced",
        advanced: true,
        fields: [
          { name: "discipline", label: "Discipline / Behavior", type: "select", listKey: "discipline" },
          { name: "mistake", label: "Mistake", type: "select", listKey: "mistake" },
          {
            name: "market_condition",
            label: "Market Condition",
            type: "select",
            listKey: "market_condition",
          },
          { name: "vix_regime", label: "VIX Regime", type: "select", listKey: "vix_regime" },
          { name: "news_nearby", label: "News Nearby", type: "select", listKey: "news_nearby" },
          { name: "lesson_learned", label: "Lesson Learned", type: "textarea", colSpan: 2 },
        ],
      },
    ],
  },
];

/** Auto-computed on save — not shown as manual inputs. */
const COMPUTED_FIELD_NAMES = ["planned_rr", "position_size"] as const;

export function getAllFormFields(): FieldConfig[] {
  const seen = new Set<string>();
  const out: FieldConfig[] = [];
  for (const tab of FORM_TABS) {
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

export const POSITION_FIELD_NAMES = [
  ...getAllFormFields().map((f) => f.name),
  ...COMPUTED_FIELD_NAMES,
];

export const NUMERIC_FIELDS = new Set(
  [...getAllFormFields().filter((f) => f.type === "number").map((f) => f.name), "position_size"],
);

export const ARRAY_FIELD_NAMES = new Set(
  getAllFormFields().filter((f) => f.type === "tags").map((f) => f.name),
);
