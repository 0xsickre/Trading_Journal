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

import { DURATION_BUCKETS, durationBucket } from "../hold-time";
import { arrayFieldValue, stringFieldValue } from "../field-values";
import { isShortDirection } from "../plan-calculations";
import {
  THESIS_STATES,
  TOUCHED_STATES,
  worstTouched,
  type PositionCheckin,
  type ThesisState,
} from "../position-checkin";
import type { EnrichedTrade } from "../enriched-trade";
import type { DailyReportLite } from "../enriched-trade";
import { isoWeekdayOfDayKey } from "../time";

/** Bucket shown when a trade has no value for the dimension. */
export const EMPTY_BUCKET = "—";

export type DimensionGroup = "trade" | "derived" | "process" | "insight" | "custom";

export type DimensionContext = {
  reportByDate: Map<string, DailyReportLite>;
  /**
   * Position id → that position's daily check-ins.
   *
   * Position-scoped, not day-scoped, and that is the whole point: the old
   * `micromanage` column lived on the DAY, so holding two positions and touching
   * one tagged both — the untouched one convicted by the calendar.
   */
  checkinsByPosition?: Map<string, PositionCheckin[]>;
  /**
   * Week start (`yyyy-MM-dd`, Monday) → the grade given in that week's review.
   *
   * Only the grade: the review's prose is written to be read, not grouped on,
   * and shipping five paragraphs per week to the browser to render one letter
   * would be paying for the whole review to draw a bucket label.
   */
  weekGradeByWeek?: Map<string, string>;
  /** rule ids that fired per trade id, for the insight dimension. */
  insightsByTrade?: Map<string, string[]>;
  /** Account id → display name. */
  accountNames?: Map<string, string>;
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
const TAG_SPLITS = [
  {
    key: "psych_emotion",
    field: "psychology_tags",
    listKey: "emotion",
    label: "Emotion",
  },
  {
    key: "psych_discipline",
    field: "psychology_tags",
    listKey: "discipline",
    label: "Discipline",
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

const SIZE_EDGES = [
  { min: -Infinity, label: "< 1" },
  { min: 1, label: "1 – 2" },
  { min: 2, label: "2 – 5" },
  { min: 5, label: "5 – 10" },
  { min: 10, label: "> 10" },
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Ime dana iz `yyyy-MM-dd` ključa, bez ponovnog razrešavanja zone.
 *
 * Delegira `isoWeekdayOfDayKey`, koji vraća ISO numeraciju 1 = ponedeljak …
 * 7 = nedelja. `WEEKDAYS` počinje nedeljom, pa `iso % 7` preslikava 7 → 0.
 *
 * Ranije je ovde stajao sopstveni `new Date(...Z).getUTCDay()` — tačan, ali
 * druga implementacija istog kalendarskog računa, sa drugom numeracijom (0–6).
 * Dve numeracije za isto pitanje su tačno onaj oblik koji se pomeša pri prvoj
 * izmeni.
 */
function weekdayOf(dayKey: string): string | null {
  const iso = isoWeekdayOfDayKey(dayKey);
  return iso === 0 ? null : WEEKDAYS[iso % 7];
}

// --- trade columns ---------------------------------------------------------

const tradeDimensions: Dimension[] = [
  column("instrument", "Instrument"),
  {
    key: "direction",
    label: "Direction",
    group: "trade",
    order: ["Long", "Short"],
    valueOf: (t) => (isShortDirection(str(t, "direction")) ? "Short" : "Long"),
  },
  column("setup_grade", "Setup Grade", "setup_grade"),
  // macro_align / cot_filter / htf_bias / entry_tf are no longer listed here:
  // they became user-defined fields in Phase 4a and arrive through
  // `customFieldDimensions`. ict_entry_model became the playbook.
  // `result` is gone: it was a manual Win/Loss/Breakeven select that duplicated
  // the derived `outcome` dimension below, and could contradict it without any
  // report noticing. Group by "Ishod" instead.
  column("exit_reason", "Exit Reason", "exit_reason"),
  column("mistake", "Mistake", "mistake"),
  column("miss_reason", "Miss reason", "miss_reason"),
  column("status", "Status"),
  tagColumn("technical_tags", "Technical Tags"),
  // Kept alongside the `emotion` / `discipline` split (see `tagSplitDimensions`)
  // rather than replaced by it: this is the only dimension that still shows a
  // free-typed tag belonging to no option list.
  tagColumn("psychology_tags", "Psychology Tags (all)"),
  {
    key: "account",
    label: "Account",
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
    label: "Hold duration",
    group: "derived",
    // From the constant `durationBucket` itself buckets by, not a copy of its
    // labels. A stale `order` entry sorts a real bucket to the bottom forever
    // and nothing errors — and the two lists sat here as separate literals.
    order: DURATION_BUCKETS,
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
    label: "Position size",
    group: "derived",
    order: SIZE_EDGES.map((e) => e.label),
    valueOf: (t) => bucketByEdges(t.size, SIZE_EDGES),
  },
  {
    key: "outcome",
    label: "Outcome",
    group: "derived",
    order: ["win", "breakeven", "loss"],
    valueOf: (t) => t.outcome,
  },
  {
    key: "month",
    label: "Month",
    group: "derived",
    valueOf: (t) => (t.closeDay ? t.closeDay.slice(0, 7) : null),
  },
  {
    key: "dow_entry",
    label: "Entry weekday",
    group: "derived",
    order: WEEKDAYS,
    valueOf: (t) => weekdayOf(t.openDay),
  },
  {
    key: "dow_exit",
    label: "Exit weekday",
    group: "derived",
    order: WEEKDAYS,
    valueOf: (t) => weekdayOf(t.closeDay),
  },
];

// --- process dimensions ----------------------------------------------------
//
// These used to be a family built by one `processDimension(key, label, window,
// …)` helper, where `window` chose whether to read the trade's open day, its
// close day, or every day of the hold. The window mattered because the journal
// was per-DAY and a trade spans several: reading the wrong end mis-attributed
// the process to the wrong decision.
//
// Two of the three windows are gone with the columns that needed them. `close`
// existed for `day_grade`, which is now weekly. `hold` existed for
// `micromanage`, which is now per-position and joins on the position id rather
// than sweeping a date range. What is left reads a single day — the open day,
// for a judgement made at entry — so the helper collapses into the one
// dimension that still uses it.

/**
 * Was this position managed, or left alone?
 *
 * Hand-written rather than a `processDimension`, because it is the one process
 * dimension that no longer reads the DAY. It used to: `micromanage` was a column
 * on `tj_daily_reports` and this dimension let the worst state across the
 * holding window win — so holding two positions and touching one tagged BOTH as
 * violated, the untouched one convicted by the calendar.
 *
 * Now each check-in names its position, so the window collapses over that
 * position's own rows. The worst-wins rule stays, and stays deliberate: touching
 * a position once in five days is the fact worth grouping on, and averaging it
 * across the quiet days would hide it.
 */
const touchedDimension: Dimension = {
  key: "touched",
  label: "Position managed",
  group: "process",
  order: [...TOUCHED_STATES],
  // No check-in at all means the question was never answered — unknown, not a
  // value, so the trade drops out rather than landing in a bucket that would
  // read as a finding.
  valueOf: (t, ctx) => {
    const rows = ctx.checkinsByPosition?.get(t.id);
    if (!rows || rows.length === 0) return null;
    return worstTouched(rows.map((r) => r.touched));
  },
};

/**
 * Did the reason for holding survive?
 *
 * Same worst-wins shape, over the thesis instead of the intervention, and the
 * ordering runs intact → invalidated so a table reads left-to-right as the
 * thesis decaying. Grouping on it answers the question a swing book exists to
 * answer: what happens to the trades I keep holding after the reason is gone.
 */
const thesisDimension: Dimension = {
  key: "thesis_state",
  label: "Thesis at close",
  group: "process",
  order: [...THESIS_STATES],
  valueOf: (t, ctx) => {
    const rows = ctx.checkinsByPosition?.get(t.id);
    if (!rows || rows.length === 0) return null;
    let worst: ThesisState | null = null;
    for (const r of rows) {
      const s = r.thesis_state;
      if (s == null) continue;
      if (worst == null || THESIS_STATES.indexOf(s) > THESIS_STATES.indexOf(worst))
        worst = s;
    }
    return worst;
  },
};

/**
 * Did the holding window cross a weekend?
 *
 * Derived on every enriched trade (see `weekend-hold.ts`), so this is a lookup,
 * not a join. It earns a dimension because a weekend gap is a DIFFERENT risk
 * from an overnight one rather than a longer one — and for a trader who crosses
 * one rarely, that rare subset is exactly the one worth grouping out.
 */
const weekendHoldDimension: Dimension = {
  key: "weekend_hold",
  label: "Weekend hold",
  group: "derived",
  order: ["Held over weekend", "Flat by Friday"],
  valueOf: (t) => (t.weekendHold ? "Held over weekend" : "Flat by Friday"),
};

/**
 * How ready you said you were, read from the day you ENTERED.
 *
 * The open day and not the close day: mental temperature is a gate checked
 * before taking the position, so on a four-day hold it belongs to Monday's
 * decision, not to Thursday's exit. No entry for that day means the gate was
 * never recorded — unknown, so the trade drops out rather than landing in a
 * bucket that would read as a finding.
 */
const mentalTempDimension: Dimension = {
  key: "mental_temp",
  label: "Mental temperature",
  group: "process",
  order: ["1–3 (poor)", "4–5 (below average)", "6–7 (good)", "8–10 (excellent)"],
  valueOf: (t, ctx) => {
    const v = ctx.reportByDate.get(t.openDay)?.mental_temp;
    if (v == null) return null;
    if (v <= 3) return "1–3 (poor)";
    if (v <= 5) return "4–5 (below average)";
    if (v <= 7) return "6–7 (good)";
    return "8–10 (excellent)";
  },
};

/**
 * Did the position outlive the exit deadline it was given?
 *
 * The trade only enters the table if it HAD a deadline — a trade with no time
 * stop is not "within" one, it is unmeasured, and bucketing it as compliant
 * would flatter every trade written before the field existed.
 *
 * Worth grouping because a time stop is the one rule a swing trader breaks
 * without noticing. Moving a stop is an act; sitting on a position for a fourth
 * day is the absence of one, and it is invisible unless something counts it.
 */
const timeStopDimension: Dimension = {
  key: "time_stop_breached",
  label: "Time stop",
  group: "derived",
  order: ["Exited in time", "Held past it"],
  valueOf: (t) =>
    t.timeStopDays == null
      ? null
      : t.pastTimeStop
        ? "Held past it"
        : "Exited in time",
};

/**
 * The grade you gave the week this trade closed in.
 *
 * The successor to the `day_grade` dimension, which Phase 2 removed. It reads
 * the CLOSE week for the reason the old one read the close day — the grade is a
 * judgement made after the fact, so it belongs to the week that had the fact.
 *
 * What this can show that the daily version could not: whether the weeks you
 * rated highly are the weeks that actually paid, which is the check on whether
 * your own sense of a good week is calibrated at all.
 */
const weekGradeDimension: Dimension = {
  key: "week_grade",
  label: "Week rating",
  group: "process",
  order: ["A", "B", "C", "D", "E", "F"],
  valueOf: (t, ctx) => ctx.weekGradeByWeek?.get(t.closeWeek) ?? null,
};

const processDimensions: Dimension[] = [
  touchedDimension,
  thesisDimension,
  weekendHoldDimension,
  timeStopDimension,
  weekGradeDimension,
  mentalTempDimension,
];

// --- insight dimension -----------------------------------------------------

const insightDimension: Dimension = {
  key: "insight",
  label: "Fired insight",
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
  trade: "Trade",
  derived: "Izvedeno",
  process: "Process",
  insight: "Insight",
  custom: "My fields",
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
