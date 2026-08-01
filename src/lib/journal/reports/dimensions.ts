/**
 * Dimension registry — the single answer to "what can I group by".
 *
 * TradeZella's ten reports are one page with a different `GROUP BY`, so this is
 * the file that makes the engine generic. **Adding a dimension is one entry
 * here and nothing else**; if a new dimension ever forces a change in
 * `engine.ts`, this abstraction was wrong.
 *
 * Buckets are a table of definitions rather than a chain of `CASE WHEN` — the
 * spec is explicit about that, and it is what lets a bucket be re-cut without
 * touching grouping logic.
 */

import { durationBucket } from "../hold-time";
import { arrayFieldValue, stringFieldValue } from "../field-values";
import { isShortDirection } from "../plan-calculations";
import type { EnrichedTrade } from "../enriched-trade";
import type { DailyReportLite } from "../enriched-trade";

/** Bucket shown when a trade has no value for the dimension. */
export const EMPTY_BUCKET = "—";

export type DimensionGroup = "trade" | "derived" | "process" | "insight" | "custom";

export type DimensionContext = {
  reportByDate: Map<string, DailyReportLite>;
  /** rule ids that fired per trade id, for the insight dimension. */
  insightsByTrade?: Map<string, string[]>;
  /** Account id → display name. */
  accountNames?: Map<string, string>;
  /** Option value → human label, per option-list key. */
  labelsByList?: Map<string, Map<string, string>>;
  /**
   * Dimensions over user-defined fields, built per request from
   * `tj_field_defs`.
   *
   * They ride on the context rather than being appended to the module-level
   * registry because the registry is process-wide and the defs are per user —
   * mutating it on a request would leak one trader's field names into another's
   * report. Everything that resolves a dimension key goes through
   * `resolveDimension`, so a custom field is addressable exactly like a built-in
   * one and the engine needs no change to support it.
   */
  customDimensions?: Dimension[];
};

export type Dimension = {
  key: string;
  label: string;
  group: DimensionGroup;
  /**
   * Bucket(s) this trade belongs to. Return `null` to exclude the trade from
   * the report entirely — different from returning `EMPTY_BUCKET`, which keeps
   * it as an explicit "no value" row.
   */
  valueOf(t: EnrichedTrade, ctx: DimensionContext): string | string[] | null;
  /** Fixed bucket order. Without it, rows sort by the chosen metric. */
  order?: readonly string[];
  /**
   * True when one trade can land in several buckets (tags, insights).
   * Consumers MUST surface this: with a multi-value dimension the rows no
   * longer sum to the portfolio total, and a reader who does not know that
   * will read the table wrongly.
   */
  multiValue?: boolean;
  /** Option-list key, when bucket values are dropdown values with labels. */
  listKey?: string;
};

// --- helpers ---------------------------------------------------------------

// Read through the accessor, never `row[key]`: a field may live in a column or
// in the `custom` jsonb bag, and a dimension must not care which.
const str = (t: EnrichedTrade, key: string): string | null =>
  stringFieldValue(t.trade.row, key);

const arr = (t: EnrichedTrade, key: string): string[] | null =>
  arrayFieldValue(t.trade.row, key);

/** A plain column dimension: one string value, empty bucket when unset. */
function column(
  key: string,
  label: string,
  listKey?: string,
): Dimension {
  return {
    key,
    label,
    group: "trade",
    listKey,
    valueOf: (t) => str(t, key) ?? EMPTY_BUCKET,
  };
}

/** A tag-array dimension: a trade lands in every tag it carries. */
function tagColumn(key: string, label: string): Dimension {
  return {
    key,
    label,
    group: "trade",
    multiValue: true,
    valueOf: (t) => arr(t, key) ?? EMPTY_BUCKET,
  };
}

// --- splitting one tag column back into its source lists --------------------

/**
 * `psychology_tags` is one column fed by TWO option lists.
 *
 * The form offers `emotion` and `discipline` merged into a single chip picker,
 * and everything picked lands in one array. Grouped by that array, "FOMO" (a
 * feeling) and "Moved stop" (an act) sit in the same table, so the obvious
 * question — which DISCIPLINE breach costs me most — cannot be asked without
 * the emotions crowding the answer.
 *
 * The fix needs no migration, because the split is recoverable: the option
 * lists say which value came from where. These specs declare the split, one
 * dimension per source list.
 */
export const TAG_SPLITS = [
  {
    key: "psych_emotion",
    field: "psychology_tags",
    listKey: "emotion",
    label: "Emocija",
  },
  {
    key: "psych_discipline",
    field: "psychology_tags",
    listKey: "discipline",
    label: "Disciplina",
  },
] as const;

/**
 * Dimensions that cut a merged tag column back into its source lists.
 *
 * Two rules, and both come straight from how the picker behaves rather than
 * from a preference:
 *
 *   - **A value in two lists belongs to the first one.** `Revenge` is seeded
 *     into both `emotion` and `discipline`, and the picker dedupes by value in
 *     `listKeys` order — so the chip the trader clicked came from `emotion`.
 *     Claiming it for `emotion` here reproduces the choice they actually made;
 *     putting it in both would count the same trade twice across two tables
 *     that are supposed to partition one column.
 *
 *   - **A value in neither list is dropped from both.** The picker also lets
 *     you type a new tag, and an old free-typed value whose option was later
 *     deleted belongs to no list. It stays visible under the combined
 *     `psychology_tags` dimension, which is kept for exactly this reason —
 *     these two are a lens on that column, not a replacement for it.
 *
 * Built per request rather than registered at module level: option lists are
 * per user, and the registry is process-wide. Same reason `customDimensions`
 * rides on the context.
 */
export function tagSplitDimensions(
  optionsMap: Record<string, readonly { value: string }[]>,
): Dimension[] {
  const claimed = new Set<string>();
  return TAG_SPLITS.map((spec) => {
    const own = new Set<string>();
    for (const item of optionsMap[spec.listKey] ?? []) {
      if (claimed.has(item.value)) continue;
      claimed.add(item.value);
      own.add(item.value);
    }
    return {
      key: spec.key,
      label: spec.label,
      group: "trade" as const,
      multiValue: true,
      listKey: spec.listKey,
      valueOf: (t: EnrichedTrade) => {
        const tags = arr(t, spec.field);
        if (!tags) return null;
        const mine = tags.filter((v) => own.has(v));
        // No tag from THIS list is not the same as no tag at all: the trade
        // recorded its psychology and simply said nothing about this half of
        // it. Excluded rather than bucketed as "—", which would read as a
        // finding about trades that never made the claim.
        return mine.length > 0 ? mine : null;
      },
    };
  });
}

/** Numeric bucketing from an ascending list of lower bounds. */
export function bucketByEdges(
  value: number | null | undefined,
  edges: readonly { min: number; label: string }[],
): string | null {
  if (value == null || Number.isNaN(value)) return null;
  let found: string | null = null;
  for (const e of edges) {
    if (value >= e.min) found = e.label;
  }
  return found ?? edges[0]?.label ?? null;
}

export const R_MULTIPLE_EDGES = [
  { min: -Infinity, label: "< -2R" },
  { min: -2, label: "-2R … -1R" },
  { min: -1, label: "-1R … 0R" },
  { min: 0, label: "0R … 1R" },
  { min: 1, label: "1R … 2R" },
  { min: 2, label: "2R … 3R" },
  { min: 3, label: "> 3R" },
] as const;

export const SIZE_EDGES = [
  { min: -Infinity, label: "< 1" },
  { min: 1, label: "1 – 2" },
  { min: 2, label: "2 – 5" },
  { min: 5, label: "5 – 10" },
  { min: 10, label: "> 10" },
] as const;

const WEEKDAYS = [
  "Nedelja",
  "Ponedeljak",
  "Utorak",
  "Sreda",
  "Četvrtak",
  "Petak",
  "Subota",
] as const;

/** Weekday name from a yyyy-MM-dd key, without re-resolving a timezone. */
function weekdayOf(dayKey: string): string | null {
  if (!dayKey) return null;
  const d = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return WEEKDAYS[d.getUTCDay()];
}

// --- trade columns ---------------------------------------------------------

const tradeDimensions: Dimension[] = [
  column("instrument", "Instrument"),
  {
    key: "direction",
    label: "Smer",
    group: "trade",
    order: ["Long", "Short"],
    valueOf: (t) => (isShortDirection(str(t, "direction")) ? "Short" : "Long"),
  },
  column("setup_grade", "Setup Grade", "setup_grade"),
  // macro_align / cot_filter / htf_bias / entry_tf are no longer listed here:
  // they became user-defined fields in Phase 4a and arrive through
  // `customFieldDimensions`. ict_entry_model became the playbook.
  column("result", "Result", "result"),
  column("exit_reason", "Exit Reason", "exit_reason"),
  column("mistake", "Greška", "mistake"),
  column("miss_reason", "Razlog propuštanja", "miss_reason"),
  column("status", "Status"),
  tagColumn("technical_tags", "Technical Tags"),
  // Kept alongside the `emotion` / `discipline` split (see `tagSplitDimensions`)
  // rather than replaced by it: this is the only dimension that still shows a
  // free-typed tag belonging to no option list.
  tagColumn("psychology_tags", "Psychology Tags (sve)"),
  {
    key: "account",
    label: "Nalog",
    group: "trade",
    valueOf: (t, ctx) =>
      t.accountId
        ? (ctx.accountNames?.get(t.accountId) ?? t.accountId)
        : EMPTY_BUCKET,
  },
];

// --- derived buckets -------------------------------------------------------

const derivedDimensions: Dimension[] = [
  {
    key: "hold_duration",
    label: "Trajanje držanja",
    group: "derived",
    order: ["<1d", "1–3d", "3–7d", "1–2w", ">2w"],
    valueOf: (t) => durationBucket(t.durationSeconds),
  },
  {
    key: "r_bucket",
    label: "R-multiple",
    group: "derived",
    order: R_MULTIPLE_EDGES.map((e) => e.label),
    valueOf: (t) => bucketByEdges(t.r, R_MULTIPLE_EDGES),
  },
  {
    key: "size_bucket",
    label: "Veličina pozicije",
    group: "derived",
    order: SIZE_EDGES.map((e) => e.label),
    valueOf: (t) => bucketByEdges(t.size, SIZE_EDGES),
  },
  {
    key: "outcome",
    label: "Ishod",
    group: "derived",
    order: ["win", "breakeven", "loss"],
    valueOf: (t) => t.outcome,
  },
  {
    key: "month",
    label: "Mesec",
    group: "derived",
    valueOf: (t) => (t.closeDay ? t.closeDay.slice(0, 7) : null),
  },
  {
    key: "dow_entry",
    label: "Dan ulaska",
    group: "derived",
    order: WEEKDAYS,
    valueOf: (t) => weekdayOf(t.openDay),
  },
  {
    key: "dow_exit",
    label: "Dan izlaska",
    group: "derived",
    order: WEEKDAYS,
    valueOf: (t) => weekdayOf(t.closeDay),
  },
];

// --- process dimensions (join on tj_daily_reports) --------------------------

/**
 * Which day of the trade the journal entry is read from.
 *
 * This is a real distinction, not a detail. Mental temperature is a judgement
 * made at ENTRY, so it reads the open day. Micromanaging happens while the
 * position is open, so it reads the whole holding window. Reading the close day
 * for either would silently mis-attribute the process to the wrong decision.
 */
type ProcessWindow = "open" | "close" | "hold";

function reportsInWindow(
  t: EnrichedTrade,
  ctx: DimensionContext,
  window: ProcessWindow,
): DailyReportLite[] {
  if (window === "open") {
    const r = ctx.reportByDate.get(t.openDay);
    return r ? [r] : [];
  }
  if (window === "close") {
    const r = ctx.reportByDate.get(t.closeDay);
    return r ? [r] : [];
  }
  const out: DailyReportLite[] = [];
  if (!t.openDay || !t.closeDay) return out;
  const cursor = new Date(`${t.openDay}T00:00:00Z`);
  const end = new Date(`${t.closeDay}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let i = 0; cursor <= end && i < 3_650; i++) {
    const r = ctx.reportByDate.get(cursor.toISOString().slice(0, 10));
    if (r) out.push(r);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function processDimension(
  key: string,
  label: string,
  window: ProcessWindow,
  pick: (reports: DailyReportLite[]) => string | null,
  order?: readonly string[],
): Dimension {
  return {
    key,
    label,
    group: "process",
    order,
    // No journal entry means the process was not recorded — that is unknown,
    // not a value, so the trade is excluded rather than lumped into a bucket
    // that would look like a finding.
    valueOf: (t, ctx) => pick(reportsInWindow(t, ctx, window)),
  };
}

const processDimensions: Dimension[] = [
  processDimension(
    "micromanage",
    "Micromanage",
    "hold",
    (rs) => {
      if (rs.length === 0) return null;
      // Worst state across the holding window wins: one violated day is the
      // fact worth grouping on.
      if (rs.some((r) => r.micromanage === "violated")) return "violated";
      if (rs.some((r) => r.micromanage === "watched")) return "watched";
      if (rs.some((r) => r.micromanage === "untouched")) return "untouched";
      return null;
    },
    ["untouched", "watched", "violated"],
  ),
  processDimension(
    "day_grade",
    "Ocena dana",
    "close",
    (rs) => rs[0]?.day_grade ?? null,
    ["A", "B", "C", "D", "E", "F"],
  ),
  processDimension(
    "mental_temp",
    "Mentalna temperatura",
    "open",
    (rs) => {
      const v = rs[0]?.mental_temp;
      if (v == null) return null;
      if (v <= 3) return "1–3 (loše)";
      if (v <= 5) return "4–5 (ispod proseka)";
      if (v <= 7) return "6–7 (dobro)";
      return "8–10 (odlično)";
    },
    ["1–3 (loše)", "4–5 (ispod proseka)", "6–7 (dobro)", "8–10 (odlično)"],
  ),
  processDimension(
    "rule_broken",
    "Prekršeno pravilo",
    "hold",
    (rs) => {
      if (rs.length === 0) return null;
      if (rs.some((r) => r.rule_broken === true)) return "da";
      if (rs.some((r) => r.rule_broken === false)) return "ne";
      return null;
    },
    ["ne", "da"],
  ),
];

// --- insight dimension -----------------------------------------------------

const insightDimension: Dimension = {
  key: "insight",
  label: "Okinuti insight",
  group: "insight",
  multiValue: true,
  valueOf: (t, ctx) => {
    const fired = ctx.insightsByTrade?.get(t.id);
    return fired && fired.length > 0 ? fired : null;
  },
};

// --- registry --------------------------------------------------------------

export const DIMENSIONS: Dimension[] = [
  ...tradeDimensions,
  ...derivedDimensions,
  ...processDimensions,
  insightDimension,
];

const byKey = new Map(DIMENSIONS.map((d) => [d.key, d]));

export function getDimension(key: string): Dimension | undefined {
  return byKey.get(key);
}

/**
 * Dimensions for the user's own fields.
 *
 * Every def becomes one — including free-text ones. A text field grouped by
 * value is usually one row per trade, which is useless as a report but harmless,
 * and refusing to register it would make "add a field, group by it" a promise
 * with an asterisk.
 */
export function customFieldDimensions(
  defs: readonly { key: string; label: string; field_type: string; list_key: string | null }[],
): Dimension[] {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    group: "custom" as const,
    listKey: def.list_key ?? undefined,
    multiValue: def.field_type === "tags",
    valueOf: (t: EnrichedTrade) =>
      def.field_type === "tags"
        ? (arr(t, def.key) ?? EMPTY_BUCKET)
        : (str(t, def.key) ?? EMPTY_BUCKET),
  }));
}

/**
 * Resolve a dimension key against the built-in registry and the request's
 * custom fields. The single lookup every consumer must use.
 */
export function resolveDimension(
  key: string,
  ctx?: Pick<DimensionContext, "customDimensions">,
): Dimension | undefined {
  return byKey.get(key) ?? ctx?.customDimensions?.find((d) => d.key === key);
}

/** Built-ins plus the user's own fields, for a dimension picker. */
export function allDimensions(custom: readonly Dimension[] = []): Dimension[] {
  return [...DIMENSIONS, ...custom];
}

export function dimensionsByGroup(group: DimensionGroup): Dimension[] {
  return DIMENSIONS.filter((d) => d.group === group);
}

export const DIMENSION_GROUP_LABELS: Record<DimensionGroup, string> = {
  trade: "Trejd",
  derived: "Izvedeno",
  process: "Proces",
  insight: "Insight",
  custom: "Moja polja",
};

export const DIMENSION_GROUP_ORDER: DimensionGroup[] = [
  "trade",
  "custom",
  "derived",
  "process",
  "insight",
];

/**
 * An ad-hoc dimension over a raw column name.
 *
 * Exists so `breakdownByField` can delegate to the engine without adopting the
 * registry's normalization. The registry improves some fields — it maps every
 * direction string onto Long/Short, for instance — and applying that silently
 * to an existing caller would change numbers that are on screen today. Callers
 * move onto registered dimensions deliberately, not by side effect.
 */
export function rawFieldDimension(field: string): Dimension {
  return {
    key: field,
    label: field,
    group: "trade",
    multiValue: true,
    valueOf: (t) => arr(t, field) ?? str(t, field) ?? EMPTY_BUCKET,
  };
}

/** Bucket keys for one trade, normalized to an array. Empty = excluded. */
export function bucketsOf(
  dimension: Dimension,
  t: EnrichedTrade,
  ctx: DimensionContext,
): string[] {
  const v = dimension.valueOf(t, ctx);
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
