import { describe, expect, it } from "vitest";
import { ruleScorecard } from "./rule-scorecard";
import {
  RULE_SAMPLE,
  buildPlaybookLookup,
  ruleSampleTier,
} from "./playbook-dimensions";
import { getMetric } from "./metrics";
import { enrich, metricCtx, type TradeSpec } from "./test-helpers";
import type { PositionRule } from "../playbook-types";

const RULES = [
  { id: "r1", text: "Waited for the sweep", show_when: "always" as const },
  { id: "r2", text: "Let it run", show_when: "winner" as const },
];

/** `n` trades, alternating win/loss by `wins`, all answering `r1` as given. */
function book(
  answers: { id: string; net: number; followed: boolean; rule?: string }[],
) {
  const byTrade = new Map<string, PositionRule[]>(
    answers.map((a) => [
      a.id,
      [{ position_id: a.id, rule_id: a.rule ?? "r1", followed: a.followed }],
    ]),
  );
  const lookup = buildPlaybookLookup(
    [{ id: "pb", name: "Book", rules: RULES }],
    byTrade,
  );
  const trades = enrich(
    answers.map((a): TradeSpec => ({ id: a.id, net: a.net, r: a.net / 100 })),
  );
  return { lookup, trades };
}

/** `n` trades of one side, alternating so `wins` of them are winners. */
function side(prefix: string, n: number, wins: number, followed: boolean) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    net: i < wins ? 100 : -100,
    followed,
  }));
}

describe("ruleScorecard — the contrast", () => {
  it("compares the rule with ITSELF, followed against broken", () => {
    // 30 followed with 21 winners = 70 %; 30 broken with 12 winners = 40 %.
    const { lookup, trades } = book([
      ...side("f", 30, 21, true),
      ...side("b", 30, 12, false),
    ]);
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);

    expect(score.n).toBe(60);
    expect(score.followed.n).toBe(30);
    expect(score.broken.n).toBe(30);
    expect(score.followed.winRate).toBeCloseTo(70, 6);
    expect(score.broken.winRate).toBeCloseTo(40, 6);
    expect(score.gapPp).toBeCloseTo(30, 6);
  });

  it("refuses a gap when the rule was never broken", () => {
    // Honest absence, not a gap of zero: printing 0 would read as "this rule
    // does nothing", which is a different claim from "no contrast exists".
    const { lookup, trades } = book(side("f", 40, 30, true));
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);
    expect(score.followed.n).toBe(40);
    expect(score.broken.n).toBe(0);
    expect(score.gapPp).toBeNull();
  });

  it("refuses a gap below the sample floor, however lopsided", () => {
    // 6 followed all winners against 4 broken all losers is a 100-point gap on
    // ten trades. That is the number the floor exists to withhold.
    const { lookup, trades } = book([
      ...side("f", 6, 6, true),
      ...side("b", 4, 0, false),
    ]);
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);
    expect(score.n).toBe(10);
    expect(score.gapPp).toBeNull();
    expect(score.tier).toBe("thin");
  });

  it("REFUSES A GAP WHEN ONLY THE TOTAL CLEARS THE FLOOR", () => {
    // The case the old rule got wrong, and it took real data to see it: neither
    // side alone is printable — the screen shows "n=14" and "n=18" rather than
    // percentages — yet the total is 32, so the difference used to print as a
    // confident "+100 pp" built from two numbers it had just refused to show.
    const { lookup, trades } = book([
      ...side("f", 14, 14, true),
      ...side("b", 18, 0, false),
    ]);
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);
    expect(score.n).toBe(32);
    expect(score.n).toBeGreaterThanOrEqual(RULE_SAMPLE.MIN); // total is fine…
    expect(score.followed.n).toBeLessThan(RULE_SAMPLE.MIN); // …the sides are not
    expect(score.broken.n).toBeLessThan(RULE_SAMPLE.MIN);
    expect(score.gapPp).toBeNull();
  });

  it("refuses a gap to a lopsided rule, however large the kept side", () => {
    // 40 followed and 2 broken clears any total floor and is still a comparison
    // resting on two trades.
    const { lookup, trades } = book([
      ...side("f", 40, 28, true),
      ...side("b", 2, 0, false),
    ]);
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);
    expect(score.followed.n).toBe(40);
    expect(score.broken.n).toBe(2);
    expect(score.gapPp).toBeNull();
  });

  it("reports the gap the moment BOTH sides reach the floor", () => {
    const { lookup, trades } = book([
      ...side("f", RULE_SAMPLE.MIN, RULE_SAMPLE.MIN, true),
      ...side("b", RULE_SAMPLE.MIN, 0, false),
    ]);
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);
    expect(score.gapPp).toBeCloseTo(100, 6);
  });

  it("counts only the population a winner-only rule was asked about", () => {
    // `r2` is winner-only. Its answer on a loser is an observation from outside
    // the population the rule applies to, and must not enter either side.
    const { lookup, trades } = book([
      { id: "w", net: 100, followed: true, rule: "r2" },
      { id: "l", net: -100, followed: false, rule: "r2" },
    ]);
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r2"]);
    expect(score.followed.n).toBe(1);
    expect(score.broken.n).toBe(0);
  });

  it("agrees with the metric registry rather than reimplementing it", () => {
    // The point of calling getMetric: a number here and the same number in
    // /reports cannot drift, because there is one implementation.
    const { lookup, trades } = book(side("f", 20, 13, true));
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["r1"]);
    const direct = getMetric("win_rate")!.compute(trades, metricCtx);
    expect(score.followed.winRate).toBe(direct);
  });

  it("returns rules in the order given and never sorts by result", () => {
    // Ranking rules by win rate is the act that turns a journal into an
    // overfitting machine, so the function does not offer it.
    const { lookup, trades } = book(side("f", 10, 5, true));
    const out = ruleScorecard(trades, lookup.rules, metricCtx, ["r2", "r1"]);
    expect(out.map((s) => s.ruleId)).toEqual(["r2", "r1"]);
  });

  it("names an unknown rule by its id rather than dropping the row", () => {
    const { lookup, trades } = book(side("f", 2, 1, true));
    const [score] = ruleScorecard(trades, lookup.rules, metricCtx, ["ghost"]);
    expect(score.text).toBe("ghost");
    expect(score.n).toBe(0);
    expect(score.followed.winRate).toBeNull();
  });
});

describe("ruleSampleTier", () => {
  it("draws the two lines the research puts them at", () => {
    expect(ruleSampleTier(0)).toBe("thin");
    expect(ruleSampleTier(RULE_SAMPLE.MIN - 1)).toBe("thin");
    expect(ruleSampleTier(RULE_SAMPLE.MIN)).toBe("provisional");
    expect(ruleSampleTier(RULE_SAMPLE.USABLE - 1)).toBe("provisional");
    expect(ruleSampleTier(RULE_SAMPLE.USABLE)).toBe("usable");
  });
});
