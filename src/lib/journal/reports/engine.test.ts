import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_SAMPLE, runReport, summarizeReport } from "./engine";
import { DEFAULT_METRIC_KEYS } from "./metrics";
import { dimCtx, enrich, metricCtx, mkReport } from "./test-helpers";

const run = (
  trades: ReturnType<typeof enrich>,
  dimension: string,
  extra: Partial<Parameters<typeof runReport>[0]> = {},
) =>
  runReport({
    trades,
    dimension,
    metricKeys: DEFAULT_METRIC_KEYS,
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
    ...extra,
  });

describe("grouping", () => {
  it("groups trades by the dimension and counts each bucket", () => {
    const r = run(
      enrich([
        { instrument: "EURUSD", net: 100 },
        { instrument: "EURUSD", net: -50 },
        { instrument: "XAUUSD", net: 300 },
      ]),
      "instrument",
    )!;
    expect(r.rows.map((x) => [x.bucket, x.n])).toEqual([
      ["XAUUSD", 1],
      ["EURUSD", 2],
    ]);
  });

  it("computes each requested metric per bucket", () => {
    const r = run(
      enrich([
        { instrument: "EURUSD", net: 200, r: 2 },
        { instrument: "EURUSD", net: -100, r: -1 },
      ]),
      "instrument",
    )!;
    const row = r.rows[0];
    expect(row.values.net_pnl).toBe(100);
    expect(row.values.trade_count).toBe(2);
    expect(row.values.win_rate).toBe(50);
    expect(row.values.profit_factor).toBe(2);
  });

  it("returns null for an unknown dimension rather than throwing", () => {
    expect(run(enrich([{}]), "not_a_dimension")).toBeNull();
  });

  it("handles an empty book", () => {
    const r = run(enrich([]), "instrument")!;
    expect(r.rows).toEqual([]);
    expect(r.totalTrades).toBe(0);
  });
});

describe("sample size", () => {
  it("flags thin buckets without hiding them", () => {
    const trades = enrich([
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `big${i}`,
        instrument: "EURUSD",
        net: 100,
      })),
      { id: "lonely", instrument: "XAUUSD", net: 900 },
    ]);
    const r = run(trades, "instrument")!;
    const thin = r.rows.find((x) => x.bucket === "XAUUSD")!;
    const solid = r.rows.find((x) => x.bucket === "EURUSD")!;
    expect(thin.belowSample).toBe(true);
    // Still present, and still carries its value — marked, not hidden.
    expect(thin.values.net_pnl).toBe(900);
    expect(solid.belowSample).toBe(false);
    expect(r.minSample).toBe(DEFAULT_MIN_SAMPLE);
  });

  it("respects a custom threshold", () => {
    const r = run(enrich([{ instrument: "EURUSD" }]), "instrument", {
      minSample: 1,
    })!;
    expect(r.rows[0].belowSample).toBe(false);
  });
});

describe("multi-value dimensions", () => {
  it("places a trade in every tag and reports the overlap", () => {
    const r = run(
      enrich([
        { id: "a", technicalTags: ["Sweep", "FVG", "MSS"], net: 300 },
        { id: "b", technicalTags: ["FVG"], net: 100 },
      ]),
      "technical_tags",
    )!;

    expect(r.multiValue).toBe(true);
    const byBucket = Object.fromEntries(r.rows.map((x) => [x.bucket, x.n]));
    expect(byBucket).toEqual({ Sweep: 1, FVG: 2, MSS: 1 });

    // The point of the flag: rows do NOT sum to the portfolio total.
    const summed = r.rows.reduce((s, x) => s + (x.values.net_pnl ?? 0), 0);
    expect(summed).toBe(1_000);
    expect(summed).not.toBe(400);
  });

  it("is false for a single-value dimension", () => {
    expect(run(enrich([{}]), "instrument")!.multiValue).toBe(false);
  });
});

describe("excluded trades", () => {
  it("counts trades the dimension had no value for", () => {
    const r = runReport({
      trades: enrich([
        { id: "logged", openedAt: "2026-01-05T09:00:00Z", closedAt: "2026-01-05T15:00:00Z" },
        { id: "unlogged", openedAt: "2026-02-05T09:00:00Z", closedAt: "2026-02-05T15:00:00Z" },
      ]),
      dimension: "mental_temp",
      metricKeys: DEFAULT_METRIC_KEYS,
      dimensionContext: dimCtx([mkReport("2026-01-05", { mental_temp: 2 })]),
      metricContext: metricCtx,
    })!;
    expect(r.totalTrades).toBe(2);
    expect(r.excluded).toBe(1);
    expect(r.rows).toHaveLength(1);
  });
});

describe("ordering", () => {
  it("keeps an ordinal dimension in its declared order", () => {
    // Sorting a duration ladder by P&L would destroy what the sequence means.
    const r = run(
      enrich([
        { durationSeconds: 20 * 86_400, net: 900 },
        { durationSeconds: 3_600, net: 10 },
        { durationSeconds: 4 * 86_400, net: 100 },
      ]),
      "hold_duration",
    )!;
    expect(r.rows.map((x) => x.bucket)).toEqual(["<1d", "3–7d", ">2w"]);
  });

  it("sorts a non-ordinal dimension by the leading metric, descending", () => {
    const r = run(
      enrich([
        { instrument: "AAA", net: 10 },
        { instrument: "BBB", net: 900 },
        { instrument: "CCC", net: -300 },
      ]),
      "instrument",
    )!;
    expect(r.rows.map((x) => x.bucket)).toEqual(["BBB", "AAA", "CCC"]);
  });

  it("sorts ascending for a metric where lower is better", () => {
    const r = run(
      enrich([
        { instrument: "CHEAP", net: 100, swap: 1 },
        { instrument: "PRICEY", net: 100, swap: 90 },
      ]),
      "instrument",
      { metricKeys: ["total_swap"], sortBy: "total_swap" },
    )!;
    expect(r.rows.map((x) => x.bucket)).toEqual(["CHEAP", "PRICEY"]);
  });

  it("ranks a bucket with no losses at the top, not the bottom", () => {
    const r = run(
      enrich([
        { instrument: "HAS_PF", net: 100, r: 1 },
        { instrument: "HAS_PF", net: -50, r: -0.5 },
        { instrument: "NO_LOSSES", net: 100, r: 1 },
      ]),
      "instrument",
      { metricKeys: ["profit_factor"], sortBy: "profit_factor" },
    )!;
    // A flawless run divides by zero loss: that is Infinity, and Infinity is
    // the best possible profit factor. Only an empty set yields null.
    expect(r.rows[0].bucket).toBe("NO_LOSSES");
    expect(r.rows[0].values.profit_factor).toBe(Infinity);
  });

  it("sinks buckets with a genuinely uncomputable value to the bottom", () => {
    const r = run(
      enrich([
        { instrument: "PLANNED", net: 100, r: 1, plannedRr: "2" },
        { instrument: "PLANNED", net: 100, r: 1, plannedRr: "2" },
        { instrument: "UNPLANNED", net: 900, r: 9, plannedRr: null },
      ]),
      "instrument",
      { metricKeys: ["target_attainment"], sortBy: "target_attainment" },
    )!;
    // No planned reward means the ratio has no denominator at all — unknown,
    // which must not outrank a measured value however good the P&L looks.
    const last = r.rows[r.rows.length - 1];
    expect(last.bucket).toBe("UNPLANNED");
    expect(last.values.target_attainment).toBeNull();
  });

  it("falls back to the bucket name when there is no metric to sort by", () => {
    // A report can legitimately ask for no metrics — the pivot builder runs the
    // engine purely for its grouping. With no metric there is no ranking, and
    // the alternative to a name sort is Map insertion order, which is the order
    // the trades happened to arrive in and changes when one is edited.
    const r = run(
      enrich([
        { instrument: "CCC", net: 10 },
        { instrument: "AAA", net: 900 },
        { instrument: "BBB", net: -300 },
      ]),
      "instrument",
      { metricKeys: [] },
    )!;
    expect(r.rows.map((x) => x.bucket)).toEqual(["AAA", "BBB", "CCC"]);
  });
});

describe("filters", () => {
  it("applies the filter set before grouping", () => {
    const r = run(
      enrich([
        { instrument: "EURUSD", setupGrade: "A" },
        { instrument: "XAUUSD", setupGrade: "B" },
      ]),
      "instrument",
      { filters: { clauses: [{ field: "setup_grade", op: "in", values: ["A"] }] } },
    )!;
    expect(r.totalTrades).toBe(1);
    expect(r.rows.map((x) => x.bucket)).toEqual(["EURUSD"]);
  });
});

describe("summarizeReport", () => {
  const trades = enrich([
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `w${i}`,
      instrument: "WINNER",
      net: 100,
      r: 1,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `l${i}`,
      instrument: "LOSER",
      net: -50,
      r: -0.5,
    })),
    { id: "thin", instrument: "THIN", net: 5_000, r: 50 },
  ]);

  it("ignores buckets under the sample threshold", () => {
    // THIN has by far the best P&L but only one trade — naming it "best" is
    // precisely the mistake this engine exists to prevent.
    const s = summarizeReport(run(trades, "instrument")!);
    expect(s.best?.bucket).toBe("WINNER");
    expect(s.worst?.bucket).toBe("LOSER");
    expect(s.qualifying).toBe(2);
  });

  it("reports the busiest bucket", () => {
    expect(summarizeReport(run(trades, "instrument")!).mostActive?.bucket).toBe(
      "LOSER",
    );
  });

  it("reports the highest win rate", () => {
    expect(
      summarizeReport(run(trades, "instrument")!).highestWinRate?.bucket,
    ).toBe("WINNER");
  });

  it("returns an empty summary when nothing qualifies", () => {
    const s = summarizeReport(run(enrich([{ instrument: "ONLY" }]), "instrument")!);
    expect(s.best).toBeNull();
    expect(s.qualifying).toBe(0);
  });
});

describe("summarizeReport respects the metric's direction", () => {
  // Six catalogue metrics declare `higherIsBetter: false`, and the metric here
  // is whichever one the user picked in the workbench. Sorting descending
  // unconditionally named the highest-fee bucket "best".
  const fees = () =>
    enrich([
      ...Array.from({ length: 5 }, () => ({ instrument: "CHEAP", fees: 1 })),
      ...Array.from({ length: 5 }, () => ({ instrument: "PRICEY", fees: 40 })),
    ]);

  it("names the LOWEST bucket best on a lower-is-better metric", () => {
    const r = run(fees(), "instrument", { metricKeys: ["total_fees"] })!;
    const s = summarizeReport(r, "total_fees");
    expect(s.best?.bucket).toBe("CHEAP");
    expect(s.worst?.bucket).toBe("PRICEY");
  });

  it("still names the highest bucket best on a higher-is-better metric", () => {
    const trades = enrich([
      ...Array.from({ length: 5 }, () => ({ instrument: "GOOD", net: 100 })),
      ...Array.from({ length: 5 }, () => ({ instrument: "BAD", net: -100 })),
    ]);
    const s = summarizeReport(run(trades, "instrument")!, "net_pnl");
    expect(s.best?.bucket).toBe("GOOD");
    expect(s.worst?.bucket).toBe("BAD");
  });

  it("reads the direction from the catalogue when the column is not requested", () => {
    // `metricKeys` here does NOT include total_fees, so the flag has to come
    // from the global catalogue rather than from result.metrics.
    const r = run(fees(), "instrument", { metricKeys: ["total_fees"] })!;
    r.metrics = [];
    expect(summarizeReport(r, "total_fees").best?.bucket).toBe("CHEAP");
  });
});

describe("summarizeReport orders ties instead of leaving them to chance", () => {
  it("does not produce an arbitrary best when two buckets are both flawless", () => {
    // `profit_factor` answers Infinity for a bucket with no losing trade, by
    // design. `Infinity - Infinity` is NaN, and a comparator returning NaN
    // leaves the sort in an unspecified order — so with two flawless buckets
    // both `best` and `worst` were whatever the engine happened to produce.
    // The row sort has always guarded equality; the summary did not.
    const r = run(
      enrich([
        { instrument: "ZZZ", net: 100, r: 1 },
        { instrument: "AAA", net: 100, r: 1 },
        { instrument: "MID", net: 100, r: 1 },
        { instrument: "MID", net: -50, r: -0.5 },
      ]),
      "instrument",
      { metricKeys: ["profit_factor"], sortBy: "profit_factor", minSample: 1 },
    )!;

    const s = summarizeReport(r, "profit_factor");
    // Both flawless buckets outrank the one that has a loss, and the tie
    // between them breaks on the bucket name — deterministically.
    expect(s.best?.bucket).toBe("AAA");
    expect(s.worst?.bucket).toBe("MID");
  });

  it("agrees with the row order it summarises", () => {
    const r = run(
      enrich([
        { instrument: "ZZZ", net: 100, r: 1 },
        { instrument: "AAA", net: 100, r: 1 },
      ]),
      "instrument",
      { metricKeys: ["profit_factor"], sortBy: "profit_factor", minSample: 1 },
    )!;
    // The table and the headline must not disagree about who is on top.
    expect(summarizeReport(r, "profit_factor").best?.bucket).toBe(r.rows[0].bucket);
  });
});
