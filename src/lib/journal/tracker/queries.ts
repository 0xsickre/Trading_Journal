import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type {
  AutoRuleKey,
  TrackerCheckin,
  TrackerRule,
  TrackerStage,
} from "../tracker-types";

type RuleRow = {
  id: string;
  text: string;
  stage: string;
  active_days: number[];
  auto_key: string | null;
  config: unknown;
  is_mandatory: boolean;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
};

/** jsonb comes back as `unknown`; only a numeric `amount` is meaningful. */
/**
 * `pct` only. A row still carrying the old money `amount` reads as
 * unconfigured, which is what the migration to percentages leaves behind on
 * purpose: a limit whose unit changed under it must be re-stated by the trader,
 * not reinterpreted by the reader.
 */
function parseConfig(raw: unknown): { pct?: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const pct = (raw as Record<string, unknown>).pct;
  return typeof pct === "number" && Number.isFinite(pct) ? { pct } : {};
}

function toRule(r: RuleRow): TrackerRule {
  return {
    id: r.id,
    text: r.text,
    stage: r.stage as TrackerStage,
    active_days: Array.isArray(r.active_days) ? r.active_days.map(Number) : [],
    auto_key: (r.auto_key as AutoRuleKey | null) ?? null,
    config: parseConfig(r.config),
    is_mandatory: r.is_mandatory,
    sort_order: r.sort_order,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
  };
}

/**
 * Tracker rules.
 *
 * `includeRetired` is the difference between the two jobs this data does, and
 * getting it backwards is silent:
 *
 *   - the CHECKLIST must not offer a retired rule (pass false);
 *   - anything computing COMPLIANCE must include retired rules (pass true),
 *     because a rule that was live on the day being scored still applied that
 *     day. Dropping it would raise every past day's score the moment you retire
 *     something.
 *
 * `compliance.ts` does the date filtering itself from `created_at` /
 * `deleted_at`, so it needs the full set to filter.
 */
export async function getTrackerRules(
  { includeRetired = false } = {},
): Promise<TrackerRule[]> {
  const supabase = await createClient();
  // `id` breaks ties: sort_order is not unique, and without a tiebreak two rules
  // sharing an ordinal reshuffle between identical page loads.
  let q = supabase
    .from("tj_tracker_rules")
    .select(
      "id,text,stage,active_days,auto_key,config,is_mandatory,sort_order,created_at,deleted_at",
    )
    .order("sort_order")
    .order("id");
  if (!includeRetired) q = q.is("deleted_at", null);

  const { data } = await q;
  return ((data ?? []) as RuleRow[]).map(toRule);
}

/**
 * Check-ins in a date window, indexed by date then rule.
 *
 * Paged: this is one row per rule per day, so it outgrows a single PostgREST
 * page inside a year — and a short page would silently drop answered rules,
 * which reads as a broken streak rather than as an error.
 */
export async function getCheckins(
  from: string,
  to: string,
): Promise<Map<string, Map<string, TrackerCheckin>>> {
  const supabase = await createClient();
  const rows = await selectAllPages<{
    rule_id: string;
    report_date: string;
    checked: boolean | null;
    auto_evaluated: boolean;
  }>((lo, hi) =>
    supabase
      .from("tj_tracker_checkins")
      .select("rule_id, report_date, checked, auto_evaluated, id")
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date")
      .order("id")
      .range(lo, hi),
  );

  const out = new Map<string, Map<string, TrackerCheckin>>();
  for (const r of rows) {
    const day = out.get(r.report_date) ?? new Map<string, TrackerCheckin>();
    day.set(r.rule_id, {
      rule_id: r.rule_id,
      report_date: r.report_date,
      checked: r.checked,
      auto_evaluated: r.auto_evaluated,
    });
    out.set(r.report_date, day);
  }
  return out;
}

