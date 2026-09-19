/**
 * Filter model.
 *
 * Two properties are load-bearing and both are decided here rather than bolted
 * on later:
 *
 *   1. **Negation is a first-class operation.** `notIn` sits beside `in` in the
 *      clause union, not as a boolean flag on a filter. The spec warns that
 *      retrofitting `Excluding` is painful, and it is right — every consumer
 *      that pattern-matches on the op would need revisiting.
 *   2. **A filter set is serializable.** Compare mode passes an array of them,
 *      and the report state lives in the URL, so a filter must survive a round
 *      trip through a query string with no loss.
 */

import {
  bucketsOf,
  EMPTY_BUCKET,
  resolveDimension,
  type DimensionContext,
} from "./dimensions";
import type { EnrichedTrade } from "../enriched-trade";

export type FilterClause =
  | { field: string; op: "in" | "notIn"; values: string[] }
  | { field: string; op: "between"; min?: number; max?: number }
  | { field: string; op: "isSet" | "isNotSet" };

export type FilterSet = {
  clauses: FilterClause[];
  /** Inclusive ISO date bounds on the CLOSE date. */
  dateFrom?: string;
  dateTo?: string;
  accountIds?: string[];
};

export const EMPTY_FILTER_SET: FilterSet = { clauses: [] };

/** Numeric fields addressable by a `between` clause. */
const NUMERIC_FIELDS: Record<string, (t: EnrichedTrade) => number | null> = {
  r: (t) => t.r,
  pnl: (t) => t.pnl,
  size: (t) => t.size,
  duration_days: (t) => t.durationDays,
  mae_r: (t) => t.excursion.maeR,
  mfe_r: (t) => t.excursion.mfeR,
};

export const NUMERIC_FIELD_LABELS: Record<string, string> = {
  r: "R-multiple",
  pnl: "P&L",
  size: "Position size",
  duration_days: "Duration (days)",
  mae_r: "MAE (R)",
  mfe_r: "MFE (R)",
};

function matchesClause(
  t: EnrichedTrade,
  clause: FilterClause,
  ctx: DimensionContext,
): boolean {
  const numeric = NUMERIC_FIELDS[clause.field];

  if (clause.op === "between") {
    // A range with neither bound constrains nothing — it is a row the reader
    // has added and not filled in yet. It used to drop every trade with no
    // value for the field, which is a filter nobody set.
    if (clause.min == null && clause.max == null) return true;
    const v = numeric?.(t) ?? null;
    if (v == null) return false;
    if (clause.min != null && v < clause.min) return false;
    if (clause.max != null && v > clause.max) return false;
    return true;
  }

  // Non-numeric clauses address a dimension, so "what counts as a value" is
  // defined in exactly one place — the registry.
  const dim = resolveDimension(clause.field, ctx);
  const buckets = dim ? bucketsOf(dim, t, ctx) : [];

  // `EMPTY_BUCKET` is a legitimate ROW in a table — "12 trades with no grade"
  // is worth seeing — but it is not a VALUE. "Has a setup grade" must be false
  // for a trade whose grade was never recorded.
  const setBuckets = buckets.filter((b) => b !== EMPTY_BUCKET);

  switch (clause.op) {
    case "isSet":
      return setBuckets.length > 0;
    case "isNotSet":
      return setBuckets.length === 0;
    case "in":
      return buckets.some((b) => clause.values.includes(b));
    case "notIn":
      // A trade with no value for the dimension is NOT excluded by a negation:
      // "not tagged FOMO" is true of a trade with no tags at all.
      return !buckets.some((b) => clause.values.includes(b));
  }
}

/**
 * One trade against a whole filter set. Not exported: `applyFilters` is the
 * only caller and the only supported entry point, and an export here invites a
 * second call site that skips the pagination `applyFilters` does around it.
 */
function matchesFilterSet(
  t: EnrichedTrade,
  filters: FilterSet,
  ctx: DimensionContext,
): boolean {
  // `closeDay`, not `closedAt.slice(0, 10)`. Slicing the ISO string reads the
  // UTC date, while every bucket in this engine — the month dimension, the
  // exit-weekday dimension, the calendar — is keyed on the account timezone.
  // A trade closed 02:00Z sits in the previous NY day, so it appeared in the
  // Jan-4 row of a table that a `to=2026-01-04` filter had just excluded it
  // from. One clock for the whole engine.
  //
  // A trade with no close instant has no close DAY either, and a date-bounded
  // question cannot be answered for it — so it drops out of either bound
  // rather than being silently kept by one and cut by the other.
  const closeDay = t.closeDay;
  if (filters.dateFrom && (!closeDay || closeDay < filters.dateFrom)) return false;
  if (filters.dateTo && (!closeDay || closeDay > filters.dateTo)) return false;
  if (
    filters.accountIds &&
    filters.accountIds.length > 0 &&
    !(t.accountId && filters.accountIds.includes(t.accountId))
  ) {
    return false;
  }
  // Clauses are ANDed; OR within a field is expressed by listing several values.
  return filters.clauses.every((c) => matchesClause(t, c, ctx));
}

export function applyFilters(
  trades: EnrichedTrade[],
  filters: FilterSet,
  ctx: DimensionContext,
): EnrichedTrade[] {
  return trades.filter((t) => matchesFilterSet(t, filters, ctx));
}

// --- URL serialization -----------------------------------------------------

const SEP = "~";

/**
 * Encode to query params.
 *
 * Clauses are packed as repeated `f` entries (`field:op:v1|v2`) rather than
 * JSON so the URL stays legible and hand-editable.
 */
export function toSearchParams(filters: FilterSet): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.dateFrom) p.set("from", filters.dateFrom);
  if (filters.dateTo) p.set("to", filters.dateTo);
  if (filters.accountIds?.length) p.set("acc", filters.accountIds.join(SEP));

  for (const c of filters.clauses) {
    if (c.op === "between") {
      p.append(
        "f",
        `${c.field}:between:${c.min ?? ""}${SEP}${c.max ?? ""}`,
      );
    } else if (c.op === "in" || c.op === "notIn") {
      p.append("f", `${c.field}:${c.op}:${c.values.join(SEP)}`);
    } else {
      p.append("f", `${c.field}:${c.op}:`);
    }
  }
  return p;
}

export function fromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): FilterSet {
  const get = (k: string): string[] => {
    if (params instanceof URLSearchParams) return params.getAll(k);
    const v = params[k];
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  };

  const clauses: FilterClause[] = [];
  for (const raw of get("f")) {
    // Only the first two colons are separators; a value may contain one.
    const first = raw.indexOf(":");
    const second = raw.indexOf(":", first + 1);
    if (first < 0 || second < 0) continue;
    const field = raw.slice(0, first);
    const op = raw.slice(first + 1, second);
    const rest = raw.slice(second + 1);
    if (!field) continue;

    if (op === "between") {
      const [min, max] = rest.split(SEP);
      const clause: FilterClause = { field, op: "between" };
      if (min !== "" && Number.isFinite(Number(min))) clause.min = Number(min);
      if (max !== "" && Number.isFinite(Number(max))) clause.max = Number(max);
      clauses.push(clause);
    } else if (op === "isSet" || op === "isNotSet") {
      clauses.push({ field, op });
    } else if (op === "in" || op === "notIn") {
      const values = rest.split(SEP).filter((v) => v !== "");
      if (values.length > 0) clauses.push({ field, op, values });
    }
  }

  const out: FilterSet = { clauses };
  const from = get("from")[0];
  const to = get("to")[0];
  const acc = get("acc")[0];
  if (from) out.dateFrom = from;
  if (to) out.dateTo = to;
  if (acc) out.accountIds = acc.split(SEP).filter(Boolean);
  return out;
}

/** True when the set would filter nothing out. */
export function isEmptyFilterSet(f: FilterSet): boolean {
  return (
    f.clauses.length === 0 &&
    !f.dateFrom &&
    !f.dateTo &&
    (f.accountIds?.length ?? 0) === 0
  );
}

/** Count of active constraints, for a "3 filtera" badge. */
export function activeFilterCount(f: FilterSet): number {
  let n = f.clauses.length;
  if (f.dateFrom || f.dateTo) n++;
  if (f.accountIds?.length) n++;
  return n;
}
