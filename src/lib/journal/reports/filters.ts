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
  getDimension,
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
  size: "Veličina pozicije",
  duration_days: "Trajanje (dana)",
  mae_r: "MAE u R",
  mfe_r: "MFE u R",
};

function matchesClause(
  t: EnrichedTrade,
  clause: FilterClause,
  ctx: DimensionContext,
): boolean {
  const numeric = NUMERIC_FIELDS[clause.field];

  if (clause.op === "between") {
    const v = numeric?.(t) ?? null;
    if (v == null) return false;
    if (clause.min != null && v < clause.min) return false;
    if (clause.max != null && v > clause.max) return false;
    return true;
  }

  // Non-numeric clauses address a dimension, so "what counts as a value" is
  // defined in exactly one place — the registry.
  const dim = getDimension(clause.field);
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

export function matchesFilterSet(
  t: EnrichedTrade,
  filters: FilterSet,
  ctx: DimensionContext,
): boolean {
  const closed = t.closedAt ?? "";
  if (filters.dateFrom && closed.slice(0, 10) < filters.dateFrom) return false;
  if (filters.dateTo && closed.slice(0, 10) > filters.dateTo) return false;
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
