/**
 * Insight engine types.
 *
 * An insight is a named, deterministic pattern found in data that already
 * exists. Nothing here is persisted: thresholds change, and a stored insight
 * would go stale against a changed threshold while looking authoritative.
 * Everything is recomputed on read.
 *
 * Every rule declares `minSample`. A pattern that fires on two trades is noise
 * wearing the costume of a finding, and the whole point of this module is to
 * raise the quality of feedback rather than the quantity of it.
 */

export type InsightLevel = "trade" | "day" | "week" | "portfolio";

export type InsightSeverity =
  /** Something went right and is worth reinforcing. */
  | "good"
  /** Neutral observation — a fact about how the trade was executed. */
  | "info"
  /** Costing money or discipline; worth attention. */
  | "warning"
  /** A pattern that historically precedes real damage. */
  | "critical";

export type Insight = {
  /** Stable rule id — also the filter key once insights become a dimension. */
  ruleId: string;
  level: InsightLevel;
  severity: InsightSeverity;
  /** Short label, e.g. "Green to red". */
  title: string;
  /** One sentence naming what happened, with the numbers that triggered it. */
  detail: string;
  /** Trade id, day key ("2026-01-05") or week key — what it attaches to. */
  subjectId: string;
  /** Human label for the subject, e.g. "#42 EURUSD" or "Nedelja 05.01". */
  subjectLabel?: string;
  /** Size of the baseline this rule compared against, when it used one. */
  sample?: number;
};

export type InsightRule<Ctx> = {
  id: string;
  level: InsightLevel;
  /**
   * Minimum number of observations the rule's BASELINE needs before it may
   * fire. Rules that compare a trade against your own history are meaningless
   * until there is enough history to be "your own".
   */
  minSample: number;
  /** Short description of what the rule looks for — surfaced in the UI. */
  description: string;
  evaluate(ctx: Ctx): Insight[];
};

export const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  good: 3,
};

export function sortInsights(insights: Insight[]): Insight[] {
  return [...insights].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

/** Group for display: one row per rule, with the subjects that triggered it. */
export type InsightGroup = {
  ruleId: string;
  title: string;
  severity: InsightSeverity;
  level: InsightLevel;
  count: number;
  insights: Insight[];
};

export function groupInsights(insights: Insight[]): InsightGroup[] {
  const map = new Map<string, InsightGroup>();
  for (const i of insights) {
    const g = map.get(i.ruleId) ?? {
      ruleId: i.ruleId,
      title: i.title,
      severity: i.severity,
      level: i.level,
      count: 0,
      insights: [],
    };
    g.count++;
    g.insights.push(i);
    map.set(i.ruleId, g);
  }
  return [...map.values()].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.count - a.count;
  });
}
