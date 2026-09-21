import { describe, expect, it } from "vitest";
import {
  ALL_RULES,
  OMITTED_RULES,
  OWN_RULES,
  TZ_RULES,
  runInsights,
  ruleById,
} from "./registry";
import { groupInsights, sortInsights, type Insight } from "./types";
import { ctxOf, mkTrade } from "./test-helpers";

describe("registry integrity", () => {
  it("has no duplicate rule ids", () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not implement anything it also lists as omitted", () => {
    const implemented = new Set(ALL_RULES.map((r) => r.id));
    for (const o of OMITTED_RULES) {
      expect(implemented.has(o.id)).toBe(false);
    }
  });

  it("gives every omitted rule a stated reason", () => {
    for (const o of OMITTED_RULES) {
      expect(o.reason.length).toBeGreaterThan(20);
    }
  });

  it("gives every rule a description and a non-negative sample floor", () => {
    for (const r of ALL_RULES) {
      expect(r.description.length).toBeGreaterThan(5);
      expect(r.minSample).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps TradeZella rules and own rules disjoint", () => {
    const tz = new Set(TZ_RULES.map((r) => r.id));
    expect(OWN_RULES.some((r) => tz.has(r.id))).toBe(false);
  });

  it("finds rules by id", () => {
    expect(ruleById("gave_back_profit")?.level).toBe("trade");
    expect(ruleById("nope")).toBeUndefined();
  });
});

describe("runInsights", () => {
  it("skips a rule whose baseline is below its minimum sample", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 100 })]);
    const { skipped } = runInsights(ctx);
    const ids = skipped.map((s) => s.id);
    // These compare against your own history and cannot fire on one trade.
    expect(ids).toContain("exceed_avg_hold_time");
    expect(ids).toContain("unusual_size");
    expect(skipped.every((s) => s.sample < s.minSample)).toBe(true);
  });

  it("runs zero-sample rules even on a single trade", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, mae: 101 })]);
    const { insights, skipped } = runInsights(ctx);
    expect(skipped.map((s) => s.id)).not.toContain("clean_hold");
    expect(insights.some((i) => i.ruleId === "clean_hold")).toBe(true);
  });

  it("returns nothing at all for an empty book", () => {
    const { insights } = runInsights(ctxOf([]));
    expect(insights).toEqual([]);
  });

  it("orders critical findings before good news", () => {
    const ctx = ctxOf([
      mkTrade({ id: "clean", net: 200, mae: 101 }),
      mkTrade({ id: "bad", net: -100, r: -1, mfe: 120 }),
    ]);
    const { insights } = runInsights(ctx);
    const first = insights[0];
    expect(first.severity).toBe("critical");
  });

  it("only runs the rules it is given", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 200, mae: 101 })]);
    const { insights } = runInsights(ctx, [ruleById("clean_hold")!]);
    expect(insights.every((i) => i.ruleId === "clean_hold")).toBe(true);
  });
});

describe("sortInsights / groupInsights", () => {
  const mk = (ruleId: string, severity: Insight["severity"]): Insight => ({
    ruleId,
    level: "trade",
    severity,
    title: ruleId,
    detail: "",
    subjectId: `${ruleId}-x`,
  });

  it("sorts by severity", () => {
    const sorted = sortInsights([
      mk("a", "good"),
      mk("b", "critical"),
      mk("c", "warning"),
    ]);
    expect(sorted.map((i) => i.severity)).toEqual([
      "critical",
      "warning",
      "good",
    ]);
  });

  it("groups by rule and counts subjects", () => {
    const groups = groupInsights([
      { ...mk("green_to_red", "critical"), subjectId: "t1" },
      { ...mk("green_to_red", "critical"), subjectId: "t2" },
      { ...mk("no_drawdown", "good"), subjectId: "t3" },
    ]);
    expect(groups[0].ruleId).toBe("green_to_red");
    expect(groups[0].count).toBe(2);
    expect(groups[1].ruleId).toBe("no_drawdown");
  });
});
