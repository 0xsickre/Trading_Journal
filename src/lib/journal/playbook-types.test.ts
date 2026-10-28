import { describe, expect, it } from "vitest";
import { libraryRuleFor, NEW_PLAYBOOK_TEMPLATE, ruleAppliesTo, SHOW_WHEN_VALUES } from "./playbook-types";

/**
 * `ruleAppliesTo` is used in two places that must never disagree: the trade
 * form, deciding which rules to offer, and the report engine, deciding which
 * answers to count. If they diverged, a rule's follow rate would be measured
 * against a population the trader was never asked about — which is why there is
 * one function and not two.
 */
describe("ruleAppliesTo", () => {
  it("offers an 'always' rule for every outcome, and before there is one", () => {
    for (const outcome of ["win", "loss", "breakeven", null] as const) {
      expect(ruleAppliesTo("always", outcome), String(outcome)).toBe(true);
    }
  });

  it("matches each outcome-scoped rule to its own outcome only", () => {
    expect(ruleAppliesTo("winner", "win")).toBe(true);
    expect(ruleAppliesTo("winner", "loss")).toBe(false);
    expect(ruleAppliesTo("winner", "breakeven")).toBe(false);

    expect(ruleAppliesTo("loser", "loss")).toBe(true);
    expect(ruleAppliesTo("loser", "win")).toBe(false);

    expect(ruleAppliesTo("breakeven", "breakeven")).toBe(true);
    expect(ruleAppliesTo("breakeven", "win")).toBe(false);
  });

  it("withholds every outcome-scoped rule while the trade is still a plan", () => {
    // "Did you let the winner run?" is not a question you can answer before
    // there is a winner. Offering it would collect an answer about nothing.
    for (const when of SHOW_WHEN_VALUES.filter((w) => w !== "always")) {
      expect(ruleAppliesTo(when, null), when).toBe(false);
    }
  });
});

describe("a new playbook's template (trader, 28.10.2026)", () => {
  it("Setup Grade: four criteria, all shown always (the database refuses a criterion that is not)", () => {
    const [grade, exit] = NEW_PLAYBOOK_TEMPLATE;
    expect(grade.label).toBe("Setup Grade");
    expect(grade.rules.every((r) => r.criterion && r.show_when === "always")).toBe(true);
    expect(grade.rules).toHaveLength(4);
    expect(exit.label).toBe("Izlaz");
    expect(exit.rules.map((r) => [r.text, r.show_when, r.criterion])).toEqual([
      ["Cut In lose", "loser", false],
      ["Cut in profit", "winner", false],
      ["TP Hit", "winner", false],
      ["SL Hit", "loser", false],
      ["BE", "breakeven", false],
    ]);
  });

  const lib = (id: string, text: string, show_when = "winner", sort_order = 0, deleted_at: string | null = null) => ({
    id,
    text,
    show_when,
    sort_order,
    deleted_at,
  });
  const tp = { text: "TP Hit", show_when: "winner" as const, criterion: false };

  it("links the live rule with the same words, case and spacing aside", () => {
    expect(libraryRuleFor(tp, [lib("a", "  tp   hit ")])).toBe("a");
  });

  it("the oldest of two copies, so books keep pooling into one", () => {
    expect(libraryRuleFor(tp, [lib("new", "TP Hit", "winner", 9), lib("old", "TP Hit", "winner", 2)])).toBe("old");
  });

  it("not a retired rule, not another 'when it shows', not other words → null, so it is created", () => {
    expect(
      libraryRuleFor(tp, [lib("r", "TP Hit", "winner", 0, "2026-10-01"), lib("w", "TP Hit", "always"), lib("x", "TP hit 2R")]),
    ).toBeNull();
    expect(libraryRuleFor(tp, [])).toBeNull();
  });
});
