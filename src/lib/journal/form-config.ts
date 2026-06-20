// Declarative config for the trade entry form. Keeps the big 49-field form
// data-driven and consistent with the DB columns and the option lists.

export type FieldType =
  | "select"
  | "instrument"
  | "number"
  | "text"
  | "textarea"
  | "url";

export type FieldConfig = {
  name: string; // tj_positions column
  label: string;
  type: FieldType;
  listKey?: string; // for select -> option list key
  placeholder?: string;
  colSpan?: 1 | 2; // grid span (of 2)
};

export type FormSection = {
  id: string;
  title: string;
  description?: string;
  fields: FieldConfig[];
};

export const FORM_SECTIONS: FormSection[] = [
  {
    id: "context",
    title: "Context",
    description: "What and when you traded.",
    fields: [
      { name: "instrument", label: "Instrument", type: "instrument" },
      { name: "direction", label: "Direction", type: "select", listKey: "direction" },
      { name: "trade_type", label: "Trade Type", type: "select", listKey: "trade_type" },
      {
        name: "session_killzone",
        label: "Session / Killzone",
        type: "select",
        listKey: "session_killzone",
      },
      { name: "htf_bias", label: "HTF Bias", type: "select", listKey: "htf_bias" },
      { name: "bias_tf", label: "Bias TF", type: "select", listKey: "bias_tf" },
      { name: "entry_tf", label: "Entry TF", type: "select", listKey: "entry_tf" },
    ],
  },
  {
    id: "ict",
    title: "ICT Setup & Analysis",
    description: "The model, POI and confluences behind the trade.",
    fields: [
      {
        name: "market_structure",
        label: "Market Structure",
        type: "select",
        listKey: "market_structure",
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
        name: "entry_poi",
        label: "Entry POI / PD Array",
        type: "select",
        listKey: "entry_poi",
      },
      {
        name: "ict_entry_model",
        label: "ICT Entry Model",
        type: "select",
        listKey: "ict_entry_model",
      },
      {
        name: "entry_trigger",
        label: "Entry Trigger",
        type: "select",
        listKey: "entry_trigger",
      },
      { name: "confluence_1", label: "Confluence 1", type: "select", listKey: "confluence" },
      { name: "confluence_2", label: "Confluence 2", type: "select", listKey: "confluence" },
      { name: "confluence_3", label: "Confluence 3", type: "select", listKey: "confluence" },
      {
        name: "smt_divergence",
        label: "SMT Divergence",
        type: "select",
        listKey: "smt_divergence",
      },
      {
        name: "num_confluences",
        label: "# Confluences",
        type: "select",
        listKey: "num_confluences",
      },
      { name: "setup_grade", label: "Setup Grade", type: "select", listKey: "setup_grade" },
      { name: "conviction", label: "Conviction", type: "select", listKey: "conviction" },
    ],
  },
  {
    id: "risk",
    title: "Risk & Execution",
    description:
      "Planned levels + logic. Actual fills (incl. partial exits) are entered below.",
    fields: [
      { name: "entry_price", label: "Planned Entry Price", type: "number" },
      { name: "stop_price", label: "Stop Price", type: "number" },
      { name: "stop_logic", label: "Stop Logic", type: "select", listKey: "stop_logic" },
      { name: "target_price", label: "Target Price", type: "number" },
      { name: "target_logic", label: "Target Logic", type: "select", listKey: "target_logic" },
      { name: "risk_pct", label: "Risk %", type: "select", listKey: "risk_pct" },
      { name: "planned_rr", label: "Planned R:R", type: "select", listKey: "planned_rr" },
      { name: "position_size", label: "Planned Size", type: "number" },
      { name: "result", label: "Result", type: "select", listKey: "result" },
      { name: "exit_reason", label: "Exit Reason", type: "select", listKey: "exit_reason" },
    ],
  },
  {
    id: "psychology",
    title: "Psychology & Review",
    description: "How you felt and what you learned.",
    fields: [
      {
        name: "emotion_before",
        label: "Emotion Before",
        type: "select",
        listKey: "emotion_before",
      },
      {
        name: "emotion_during",
        label: "Emotion During",
        type: "select",
        listKey: "emotion_during",
      },
      {
        name: "emotion_after",
        label: "Emotion After",
        type: "select",
        listKey: "emotion_after",
      },
      {
        name: "discipline",
        label: "Discipline / Behavior",
        type: "select",
        listKey: "discipline",
      },
      { name: "mistake", label: "Mistake", type: "select", listKey: "mistake" },
      {
        name: "rules_followed",
        label: "Rules Followed",
        type: "select",
        listKey: "rules_followed",
      },
      {
        name: "market_condition",
        label: "Market Condition",
        type: "select",
        listKey: "market_condition",
      },
      { name: "vix_regime", label: "VIX Regime", type: "select", listKey: "vix_regime" },
      { name: "news_nearby", label: "News Nearby", type: "select", listKey: "news_nearby" },
      {
        name: "chart_url",
        label: "TradingView Chart URL",
        type: "url",
        placeholder: "https://www.tradingview.com/x/…",
        colSpan: 2,
      },
      { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
      { name: "lesson_learned", label: "Lesson Learned", type: "textarea", colSpan: 2 },
    ],
  },
];

// All position dropdown/text/number column names (for building defaults).
export const POSITION_FIELD_NAMES = FORM_SECTIONS.flatMap((s) =>
  s.fields.map((f) => f.name),
);

export const NUMERIC_FIELDS = new Set(
  FORM_SECTIONS.flatMap((s) =>
    s.fields.filter((f) => f.type === "number").map((f) => f.name),
  ),
);
