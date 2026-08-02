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
          groups: [
            {
              rules: [
                { id: "r1", text: "Waited for confirmation", show_when: "always" },
                { id: "r2", text: "Sized to plan", show_when: "always" },
              ],
            },
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
