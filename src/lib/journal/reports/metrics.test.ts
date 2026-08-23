import { describe, expect, it } from "vitest";
import { DEFAULT_METRIC_KEYS, METRICS, getMetric } from "./metrics";
import { DAY, enrich, metricCtx } from "./test-helpers";
import { buildPlaybookLookup } from "./playbook-dimensions";

/**
 * The metric registry had **no test file at all** — 353 lines, 25 of its 26
 * `compute` callbacks never executed by a test, and every column of every report
 * reads through it.
 *
 * The registry's own header states the contract it lives by: *"this file is a
 * registry, not a second implementation. If a metric here ever computes
 * something inline that `analytics.ts` or a Phase 1 module also computes, the two
 * will drift and one of them will be wrong."* Nothing checked that either.
 *
 * So this file tests the registry AS a registry: every entry, uniformly, against
 * the properties all of them must hold — and then the handful whose values are
 * worth pinning individually.
 */

/** A small book with a win, a loss and a breakeven-ish trade, over three days. */
const BOOK = enrich([
  {
    id: "w",
    net: 300,
    gross: 320,
    r: 3,
    fees: 20,
    openedAt: "2026-03-02T14:00:00Z",
    closedAt: "2026-03-02T18:00:00Z",
    durationSeconds: 4 * 3600,
    setupGrade: "A",
    instrument: "XAUUSD",
    plannedRr: "2",
    mae: -50,
  },
  {
    id: "l",
    net: -100,
    gross: -90,
    r: -1,
    fees: 10,
    swap: 5,
    openedAt: "2026-03-03T14:00:00Z",
    closedAt: "2026-03-03T18:00:00Z",
    durationSeconds: 4 * 3600,
    setupGrade: "B",
    instrument: "XAUUSD",
    plannedRr: "3",
    mae: -120,
  },
  {
    id: "b",
    net: 5,
    gross: 8,
    r: 0.05,
    fees: 3,
    openedAt: "2026-03-04T14:00:00Z",
    closedAt: "2026-03-06T18:00:00Z",
    durationSeconds: 2 * DAY,
    setupGrade: "A",
    instrument: "NAS100",
    plannedRr: "1",
  },
]);

describe("registry integrity", () => {
  it("has no duplicate keys", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every metric a label, a unit and a direction", () => {
    for (const m of METRICS) {
      expect(m.label.length, m.key).toBeGreaterThan(0);
      expect(
        ["money", "r", "pct", "points", "count", "seconds", "ratio"],
        m.key,
      ).toContain(m.unit);
      expect(typeof m.higherIsBetter, m.key).toBe("boolean");
    }
  });

  it("resolves every default column, so a fresh report cannot render blank", () => {
    for (const key of DEFAULT_METRIC_KEYS) {
      expect(getMetric(key), key).toBeDefined();
    }
  });

  it("answers undefined for a key it does not know", () => {
    expect(getMetric("no_such_metric")).toBeUndefined();
  });

  it("declares no metric in a unit nothing produces", () => {
    // `points` is a legal MetricUnit and `formatMetric` has a whole branch for
    // it, but no metric in the registry emits it — recorded in step 3 and
    // pinned here. If one is ever added, this fails and the reviewer is sent to
    // check that the report table passes an instrument context, without which
    // the points branch silently renders as money.
    expect(METRICS.filter((m) => m.unit === "points")).toEqual([]);
  });
});

describe("every metric computes without throwing", () => {
  // The property that matters most and is cheapest to lose: a report renders
  // one column per metric over an arbitrary bucket, and a single throw takes
  // the whole page down rather than blanking one cell.
  it("over a normal group", () => {
    for (const m of METRICS) {
      expect(() => m.compute(BOOK, metricCtx), m.key).not.toThrow();
    }
  });

  it("over an EMPTY group, answering a number or null — never NaN", () => {
    // Empty buckets are routine: a filter that excludes everything, a pivot
    // cell with no intersection. NaN would render as "NaN" and sort randomly.
    for (const m of METRICS) {
      const v = m.compute([], metricCtx);
      expect(v === null || Number.isFinite(v), `${m.key} → ${v}`).toBe(true);
    }
  });

  it("over a single trade, which is where averages divide by one", () => {
    for (const m of METRICS) {
      const v = m.compute([BOOK[0]], metricCtx);
      expect(
        v === null || Number.isFinite(v) || v === Infinity,
        `${m.key} → ${v}`,
      ).toBe(true);
    }
  });

  it("never answers NaN, on any group", () => {
    // NaN is the one value with no meaning: it renders as "NaN", compares false
    // against itself, and poisons any comparator that reaches it. Infinity is
    // allowed — `profit_factor` uses it deliberately for a bucket with no loss —
    // but NaN never is.
    for (const group of [BOOK, [BOOK[0]], [BOOK[1]], [BOOK[2]], []]) {
      for (const m of METRICS) {
        const v = m.compute(group, metricCtx);
        expect(v === null || !Number.isNaN(v), `${m.key} → ${v}`).toBe(true);
      }
    }
  });

  it("answers Infinity for profit factor ONLY where that is the design", () => {
    // Pinned because it looks like a bug and is not: a flawless bucket has the
    // best possible profit factor, which is a different claim from "no
    // denominator exists" (null). `engine.test.ts` pins the ranking half.
    expect(getMetric("profit_factor")!.compute([BOOK[0]], metricCtx)).toBe(
      Infinity,
    );
    // An empty group is the null case — nothing to divide at all.
    expect(getMetric("profit_factor")!.compute([], metricCtx)).toBeNull();
  });
});

describe("the values a reader would check by hand", () => {
  const val = (key: string, group = BOOK) => getMetric(key)!.compute(group, metricCtx);

  it("sums money the way the trades add up", () => {
    expect(val("net_pnl")).toBeCloseTo(300 - 100 + 5, 10);
    expect(val("gross_pnl")).toBeCloseTo(320 - 90 + 8, 10);
    expect(val("trade_count")).toBe(3);
  });

  it("counts wins and losses on the account's breakeven band", () => {
    // `metricCtx` uses EXACT_ZERO_RANGE, so +5 is a win, not a breakeven. The
    // band is the account's business and the registry must read it from the
    // context rather than assume one.
    expect(val("win_rate")).toBeCloseTo((2 / 3) * 100, 10);
    expect(val("breakeven_count")).toBe(0);
  });

  it("computes profit factor as gross profit over gross loss", () => {
    expect(val("profit_factor")).toBeCloseTo(305 / 100, 10);
  });

  it("keeps profit factor infinite when nothing lost", () => {
    expect(val("profit_factor", [BOOK[0]])).toBe(Infinity);
  });

  it("reads R straight off the trades", () => {
    expect(val("total_r")).toBeCloseTo(3 - 1 + 0.05, 10);
    expect(val("avg_r")).toBeCloseTo((3 - 1 + 0.05) / 3, 10);
  });

  it("adds up the costs", () => {
    expect(val("total_fees")).toBeCloseTo(33, 10);
    expect(val("total_swap")).toBeCloseTo(5, 10);
  });

  it("reports the worst peak-to-trough inside the group, not the whole book", () => {
    // Cumulative +300, +200, +205 → the deepest drop is the 100 given back.
    expect(val("max_drawdown")).toBeCloseTo(-100, 10);
  });

  it("leaves recovery factor null while the curve has never fallen", () => {
    expect(val("recovery_factor", [BOOK[0]])).toBeNull();
    expect(val("recovery_factor")).toBeCloseTo(205 / 100, 10);
  });

  it("measures hold time in seconds, so the unit matches the formatter", () => {
    expect(val("avg_hold")).toBeCloseTo((4 * 3600 + 4 * 3600 + 2 * DAY) / 3, 6);
  });

  it("compares planned R against realized R over the SAME trades", () => {
    // Averaging planned over one set and realized over a larger one produces a
    // difference that means nothing — the module says so and this pins it.
    const planned = val("avg_planned_r")!;
    const delta = val("delta_r")!;
    expect(planned).toBeCloseTo(2, 10);
    expect(delta).toBeCloseTo((3 - 1 + 0.05) / 3 - 2, 10);
  });

  it("averages MAE only over trades that carry one", () => {
    // Two of three have an MAE. Treating the third as 0 would halve the number.
    expect(val("avg_mae_r")).not.toBeNull();
    expect(val("avg_mae_r", [BOOK[2]])).toBeNull();
  });
});

describe("follow_rate is the one metric that depends on WHICH bucket it is in", () => {
  it("answers null when no playbook data is loaded", () => {
    // Null rather than 0: a zero would read as "no rule was ever followed",
    // which is a finding rather than a missing input.
    expect(getMetric("follow_rate")!.compute(BOOK, metricCtx)).toBeNull();
  });

  it("counts answers to THAT rule when a scope is passed", () => {
    const lookup = buildPlaybookLookup(
      [
        {
          id: "pb",
          name: "Book",
          rules: [
            { id: "r1", text: "Waited for confirmation", show_when: "always" },
            { id: "r2", text: "Sized to plan", show_when: "always" },
          ],
        },
      ],
      new Map([
        ["w", [{ position_id: "w", rule_id: "r1", followed: true }]],
        ["l", [{ position_id: "l", rule_id: "r1", followed: false }]],
        ["b", [{ position_id: "b", rule_id: "r2", followed: true }]],
      ]),
    );
    const ctx = { ...metricCtx, rules: lookup.rules };
    const m = getMetric("follow_rate")!;

    // Scoped to rule r1's text: one followed of two answered.
    expect(m.compute(BOOK, ctx, ["Waited for confirmation"])).toBeCloseTo(50, 10);
    // Unscoped: every answer across the group — two of three.
    expect(m.compute(BOOK, ctx)).toBeCloseTo((2 / 3) * 100, 10);
  });
});

/**
 * The three entries added when the dashboard's execution tiles moved here.
 *
 * They exist so `/reports` can state what the dashboard stopped stating, and
 * the reason each one is worth pinning is the same: the underlying function
 * answers `0` for "nothing measured", and `0` is a perfectly plausible reading
 * of the metric itself. A fill exactly at plan is `0` slippage; a book with no
 * planned entries recorded is also `0`. Only one of those is a measurement.
 */
describe("execution metrics relocated from the dashboard", () => {
  const val = (key: string, group = BOOK) =>
    getMetric(key)!.compute(group, metricCtx);

  it("tells a fill exactly at plan apart from no fills measured at all", () => {
    // The whole reason the guard exists. `computeSlippageStats` answers
    // `avgAdverseR: 0` for BOTH — and only one of them is a measurement.
    //
    // This book's trades all plan an entry at 100 and fill at 100, so zero is
    // the honest answer: perfect fills.
    expect(val("avg_entry_slip")).toBe(0);
    expect(val("total_slip_r")).toBe(0);
    // With nothing to measure the metric declines to answer, rather than
    // reporting the same zero and calling it flawless execution.
    expect(val("avg_entry_slip", [])).toBeNull();
    expect(val("total_slip_r", [])).toBeNull();
  });

  it("declares slippage higher-is-better, matching the flipped sign", () => {
    // The registry publishes `-avgAdverseR`, so a worse fill is a MORE
    // negative number and "higher is better" is the honest direction. If the
    // sign ever stops being flipped in `compute`, this flag becomes a lie and
    // the bar colouring inverts across the whole reports screen.
    expect(getMetric("avg_entry_slip")!.higherIsBetter).toBe(true);
    expect(getMetric("total_slip_r")!.higherIsBetter).toBe(true);
    expect(getMetric("avg_entry_slip")!.unit).toBe("r");
  });

  it("declines to score consistency on an empty book, but scores a losing one", () => {
    // Two books, one number, opposite meanings. `consistencyScore` answers 0
    // for both — the losing book because it has earned that verdict, the empty
    // one because there is nothing to divide. Surfaced by the new /reports
    // panel, where a confident `0` sat next to five honest dashes.
    expect(val("consistency", [])).toBeNull();

    const losing = enrich([
      { id: "x", net: -100, r: -1 },
      { id: "y", net: -200, r: -2 },
    ]);
    expect(val("consistency", losing)).toBe(0);
  });

  it("measures winner target attainment over WINNERS, not the whole book", () => {
    // Two of the three trades closed green: `w` planned 2R and took 3 (150 %),
    // `b` planned 1R and took 0.05 (5 %). Mean 77.5.
    const winners = val("winner_target_attainment");
    const all = val("target_attainment");
    expect(winners).toBeCloseTo(77.5, 6);
    // The loser drags the all-trades figure below the winners-only one, which
    // is the entire reason both tiles existed side by side on the dashboard.
    expect(all!).toBeLessThan(winners!);
    expect(val("winner_target_attainment", [])).toBeNull();
  });
});

describe("setup_score — the grade derived from criteria, not typed after the fact", () => {
  /**
   * Two criteria on one playbook. A trade scores only when BOTH were answered:
   * an unanswered criterion is stored as no row at all, so counting the answers
   * alone would score three of four as three of three — a grade that goes up
   * the less of the checklist you fill in.
   */
  const lookup = (answers: Map<string, { position_id: string; rule_id: string; followed: boolean }[]>) =>
    buildPlaybookLookup(
      [
        {
          id: "pb",
          name: "Book",
          rules: [
            { id: "c1", text: "Swept liquidity", show_when: "always", is_setup_criterion: true },
            { id: "c2", text: "Displacement", show_when: "always", is_setup_criterion: true },
            { id: "r3", text: "Sized to plan", show_when: "always" },
          ],
        },
      ],
      answers,
    );

  const answer = (tradeId: string, followed: [string, boolean][]) =>
    [tradeId, followed.map(([rule_id, f]) => ({ position_id: tradeId, rule_id, followed: f }))] as const;

  const score = (
    trades: ReturnType<typeof enrich>,
    answers: Map<string, { position_id: string; rule_id: string; followed: boolean }[]>,
  ) =>
    getMetric("setup_score")!.compute(trades, { ...metricCtx, rules: lookup(answers).rules });

  it("answers null when no playbook data is loaded", () => {
    // The same reasoning as `follow_rate`: a zero here would read as "every
    // setup failed every criterion", which is a finding rather than a gap.
    const book = enrich([{ id: "a", playbookId: "pb" }]);
    expect(getMetric("setup_score")!.compute(book, metricCtx)).toBeNull();
  });

  it("averages the share of criteria met over the trades that have a full checklist", () => {
    const book = enrich([
      { id: "a", playbookId: "pb" },
      { id: "b", playbookId: "pb" },
    ]);
    const answers = new Map([
      answer("a", [["c1", true], ["c2", true]]), // 100 %
      answer("b", [["c1", true], ["c2", false]]), // 50 %
    ]);
    expect(score(book, answers)).toBeCloseTo(75, 10);
  });

  it("leaves an incomplete checklist out of BOTH halves of the average", () => {
    // `b` answered one of two criteria. Scoring it 50 % would invent an answer
    // to a question nobody asked; scoring it 0 % would invent a failure. It has
    // no score, so it must not move the average of the trades that do.
    const book = enrich([
      { id: "a", playbookId: "pb" },
      { id: "b", playbookId: "pb" },
    ]);
    const answers = new Map([
      answer("a", [["c1", true], ["c2", true]]),
      answer("b", [["c1", true]]),
    ]);
    expect(score(book, answers)).toBeCloseTo(100, 10);
  });

  it("answers null when no trade in the group carries a complete checklist", () => {
    const book = enrich([{ id: "a", playbookId: "pb" }]);
    expect(score(book, new Map([answer("a", [["c1", true]])]))).toBeNull();
  });

  it("ignores a trade taken from no playbook at all", () => {
    // Nothing to grade it against: there is no criteria list without a book.
    const book = enrich([
      { id: "a", playbookId: "pb" },
      { id: "free", playbookId: null },
    ]);
    const answers = new Map([answer("a", [["c1", true], ["c2", false]])]);
    expect(score(book, answers)).toBeCloseTo(50, 10);
  });
});
