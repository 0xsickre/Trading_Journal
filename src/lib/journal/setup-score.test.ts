import { describe, expect, it } from "vitest";
import {
  gradeFromPct,
  setupScoreFromTrade,
  type ScorableTrade,
} from "./setup-score";
import { buildPlaybookLookup } from "./reports/playbook-dimensions";
import type { PositionRule } from "./playbook-types";
import type { TradeRow } from "./types";

/**
 * A trade carrying only what the score reads: its id, and the playbook named on
 * its row. `outcome` matters because `applicableAnswers` filters on it, and
 * "loser" is used on purpose — a criterion must count the same whichever way the
 * trade went, which is the entire reason criteria are pinned to
 * `show_when = 'always'`.
 */
function trade(id: string, playbookId: string | null): ScorableTrade {
  return {
    id,
    outcome: "loss",
    row: { playbook_id: playbookId } as unknown as TradeRow,
  };
}

function lookup(
  criteria: readonly string[],
  otherRules: readonly string[] = [],
  answers: readonly PositionRule[] = [],
) {
  const rules = [
    ...criteria.map((id) => ({
      id,
      text: id,
      show_when: "always" as const,
      is_setup_criterion: true,
    })),
    ...otherRules.map((id) => ({
      id,
      text: id,
      show_when: "always" as const,
      is_setup_criterion: false,
    })),
  ];
  const byTrade = new Map<string, PositionRule[]>();
  for (const a of answers) {
    byTrade.set(a.position_id, [...(byTrade.get(a.position_id) ?? []), a]);
  }
  return buildPlaybookLookup([{ id: "pb1", name: "Swing", rules }], byTrade).rules;
}

const answer = (ruleId: string, followed: boolean | null): PositionRule => ({
  position_id: "t1",
  rule_id: ruleId,
  followed,
});

describe("gradeFromPct", () => {
  it("reserves A+ for a setup that met every one of its conditions", () => {
    // The label means "this was the setup I said I was waiting for". A setup
    // missing one of its own defining conditions is a different setup.
    expect(gradeFromPct(100)).toBe("A+");
    expect(gradeFromPct(99.9)).toBe("A");
  });

  it("bands the rest at eighty and sixty", () => {
    expect(gradeFromPct(80)).toBe("A");
    expect(gradeFromPct(79.9)).toBe("B");
    expect(gradeFromPct(60)).toBe("B");
    expect(gradeFromPct(59.9)).toBe("C");
    expect(gradeFromPct(0)).toBe("C");
  });
});

describe("setupScoreFromTrade", () => {
  it("scores the share of criteria met", () => {
    const rules = lookup(
      ["c1", "c2", "c3", "c4"],
      [],
      [answer("c1", true), answer("c2", true), answer("c3", false), answer("c4", true)],
    );
    expect(setupScoreFromTrade(trade("t1", "pb1"), rules)).toEqual({
      met: 3,
      total: 4,
      pct: 75,
      grade: "B",
    });
  });

  /**
   * The hole this function exists to close, and the one the first draft had.
   *
   * An unanswered rule is stored as NO ROW. Counting the rows present would read
   * three of four criteria as three of three and hand out an A+ for an
   * unfinished checklist — a perfect score for having answered less.
   */
  it("refuses to grade when a criterion was never answered", () => {
    const rules = lookup(
      ["c1", "c2", "c3", "c4"],
      [],
      [answer("c1", true), answer("c2", true), answer("c3", true)],
    );
    expect(setupScoreFromTrade(trade("t1", "pb1"), rules)).toBeNull();
  });

  it("refuses a row that carries no verdict", () => {
    const rules = lookup(["c1", "c2"], [], [answer("c1", true), answer("c2", null)]);
    expect(setupScoreFromTrade(trade("t1", "pb1"), rules)).toBeNull();
  });

  it("ignores rules that are not criteria", () => {
    // Process rules ("risk under 1 %", "wrote a thesis") belong to follow rate.
    // If they counted here, tidying the paperwork would move the setup grade.
    const rules = lookup(
      ["c1", "c2"],
      ["p1", "p2"],
      [
        answer("c1", true),
        answer("c2", true),
        answer("p1", false),
        answer("p2", false),
      ],
    );
    expect(setupScoreFromTrade(trade("t1", "pb1"), rules)).toMatchObject({
      met: 2,
      total: 2,
      grade: "A+",
    });
  });

  it("has nothing to say without a playbook", () => {
    const rules = lookup(["c1"], [], [answer("c1", true)]);
    expect(setupScoreFromTrade(trade("t1", null), rules)).toBeNull();
  });

  it("has nothing to say when the playbook marks no criteria", () => {
    const rules = lookup([], ["p1"], [answer("p1", true)]);
    expect(setupScoreFromTrade(trade("t1", "pb1"), rules)).toBeNull();
  });

  it("has nothing to say when the checklist was never opened", () => {
    const rules = lookup(["c1", "c2"], [], []);
    expect(setupScoreFromTrade(trade("t1", "pb1"), rules)).toBeNull();
  });

  it("gives every criterion the same weight", () => {
    // There is no weighting column and this is the test that says so out loud:
    // two of four is 50 % regardless of which two.
    const first = lookup(
      ["c1", "c2", "c3", "c4"],
      [],
      [answer("c1", true), answer("c2", true), answer("c3", false), answer("c4", false)],
    );
    const last = lookup(
      ["c1", "c2", "c3", "c4"],
      [],
      [answer("c1", false), answer("c2", false), answer("c3", true), answer("c4", true)],
    );
    expect(setupScoreFromTrade(trade("t1", "pb1"), first)?.pct).toBe(50);
    expect(setupScoreFromTrade(trade("t1", "pb1"), last)?.pct).toBe(50);
  });
});
