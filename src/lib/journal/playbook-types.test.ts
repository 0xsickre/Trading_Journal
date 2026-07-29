import { describe, expect, it } from "vitest";
import { ruleAppliesTo, SHOW_WHEN_VALUES } from "./playbook-types";

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
