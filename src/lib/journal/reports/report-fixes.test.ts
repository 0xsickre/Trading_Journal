import { describe, expect, it } from "vitest";
import { enrichTrades } from "../enriched-trade";
import { bucketLabel, getDimension } from "./dimensions";
import { parseSort, runReport, summarizeReport } from "./engine";
import { getMetric } from "./metrics";
import { dimCtx, enrich, metricCtx, mkTrade, type TradeSpec } from "./test-helpers";

/**
 * The Reports audit of 19.09.2026, one test per finding: each failed on the
 * code as it was, and says what the reader saw.
 */

const value = (key: string, specs: TradeSpec[], ctx = metricCtx) =>
  getMetric(key)!.compute(enrich(specs), ctx);

describe("a metric with nothing to measure is empty, not a zero", () => {
  it("win rate of a bucket holding only breakeven scratches", () => {
    // Read "0.0%" — a finding about trades that were never decided.
    expect(value("win_rate", [{ net: 0 }, { net: 0 }])).toBeNull();
    expect(value("win_rate", [{ net: 100 }, { net: -100 }])).toBe(50);
  });

  it("the R figures of a bucket where no trade carries a stop", () => {
    // Read "+0.00R" expectancy, which then sorted above every losing bucket.
    const noStops: TradeSpec[] = [{ net: 100, r: null }, { net: -50, r: null }];
    for (const k of ["expectancy", "avg_r", "total_r", "avg_win", "avg_loss"]) {
      expect(value(k, noStops), k).toBeNull();
    }
  });

  it("average loss with no loser, and average win with no winner", () => {
    // `avg_loss` of 0 ranked a loss-free bucket as having the best average loss.
    expect(value("avg_loss", [{ net: 100, r: 1 }])).toBeNull();
    expect(value("avg_win", [{ net: -100, r: -1 }])).toBeNull();
    expect(value("avg_loss", [{ net: -100, r: -1 }])).toBe(-1);
  });

  it("an empty bucket is never named best", () => {
    const trades = enrich([
      ...Array.from({ length: 5 }, (): TradeSpec => ({ instrument: "XAUUSD", net: -100, r: -1 })),
      ...Array.from({ length: 5 }, (): TradeSpec => ({ instrument: "NAS100", net: 50, r: null })),
    ]);
    const result = runReport({
      trades,
      dimension: "instrument",
      metricKeys: ["expectancy"],
      dimensionContext: dimCtx(),
      metricContext: metricCtx,
    })!;
    // NAS100 has no R at all: it sorts last and cannot win.
    expect(result.rows.map((r) => r.bucket)).toEqual(["XAUUSD", "NAS100"]);
    expect(summarizeReport(result, "expectancy").best?.bucket).toBe("XAUUSD");
  });
});

describe("recovery factor on the Gross basis", () => {
  it("divides gross profit by the gross drawdown, not net by gross", () => {
    const specs: TradeSpec[] = [
      { net: 1000, gross: 1100, closedAt: "2026-01-01T10:00:00Z" },
      { net: -600, gross: -500, closedAt: "2026-01-02T10:00:00Z" },
      { net: 400, gross: 500, closedAt: "2026-01-03T10:00:00Z" },
    ];
    const gross = enrichTrades(specs.map(mkTrade), {
      tzOf: () => "UTC",
      pnlOf: (t) => t.gross,
    });
    const rf = getMetric("recovery_factor")!.compute(gross, {
      ...metricCtx,
      pnlBasis: "gross",
    });
    // Gross profit 1100 over a gross drawdown of 500. Mixed, it read 800 / 500.
    expect(rf).toBeCloseTo(2.2, 6);
  });
});

describe("drawdown inside a bucket", () => {
  it("keeps a trade with no close time, as the book's own figure does", () => {
    const dd = value("max_drawdown", [
      { net: -200, closedAt: "" },
      { net: 100, closedAt: "2026-01-02T10:00:00Z" },
      { net: -300, closedAt: "2026-01-03T10:00:00Z" },
    ]);
    // -200, -100, -400: the fall from 0 is 400. Dropping the first trade said 300.
    expect(dd).toBe(-400);
  });
});

describe("grouping", () => {
  const report = (specs: TradeSpec[], dimension: string, sortBy?: string) =>
    runReport({
      trades: enrich(specs),
      dimension,
      metricKeys: ["net_pnl", "trade_count"],
      dimensionContext: dimCtx(),
      metricContext: metricCtx,
      sortBy,
    })!;

  it("counts a trade once in a bucket even when the tag is stored twice", () => {
    const r = report([{ technicalTags: ["FVG", "FVG"], net: 100 }], "technical_tags");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].n).toBe(1);
    expect(r.rows[0].values.net_pnl).toBe(100);
  });

  it("lists months oldest first, whatever they made", () => {
    const r = report(
      [
        { net: 900, closedAt: "2019-06-10T10:00:00Z" },
        { net: -50, closedAt: "2018-03-05T10:00:00Z" },
      ],
      "month",
    );
    // Sorted by P&L it put June 2019 above March 2018.
    expect(r.rows.map((x) => x.bucket)).toEqual(["2018-03", "2019-06"]);
    expect(bucketLabel(getDimension("month"), "2018-03")).toBe("Mar 2018");
  });

  it("starts the week on Monday", () => {
    expect(getDimension("dow_exit")!.order?.[0]).toBe("Monday");
    expect(getDimension("dow_exit")!.order?.at(-1)).toBe("Sunday");
    // 5 Jan 2026 is a Monday.
    const r = report([{ closedAt: "2026-01-05T10:00:00Z" }], "dow_exit");
    expect(r.rows[0].bucket).toBe("Monday");
  });

  it("sorts either way on request, and ignores a sort on a column it lacks", () => {
    const specs: TradeSpec[] = [
      { instrument: "A", net: 100 },
      { instrument: "B", net: 300 },
      { instrument: "C", net: -50 },
    ];
    expect(report(specs, "instrument").rows.map((r) => r.bucket)).toEqual(["B", "A", "C"]);
    expect(report(specs, "instrument", "net_pnl:asc").rows.map((r) => r.bucket)).toEqual([
      "C",
      "A",
      "B",
    ]);
    // An ordered dimension keeps its order under a sort it cannot apply.
    expect(
      report([{ direction: "Short" }, { direction: "Long" }], "direction", "sharpe:desc").rows.map(
        (r) => r.bucket,
      ),
    ).toEqual(["Long", "Short"]);
  });

  it("reads a sort from the URL", () => {
    expect(parseSort("net_pnl:asc")).toEqual({ key: "net_pnl", dir: "asc" });
    expect(parseSort("net_pnl")).toEqual({ key: "net_pnl", dir: null });
    expect(parseSort("net_pnl:up")).toEqual({ key: "net_pnl", dir: null });
    expect(parseSort("")).toBeNull();
    expect(parseSort(":asc")).toBeNull();
  });

  it("calls a trade with no value '(none)', not '—'", () => {
    expect(bucketLabel(getDimension("instrument"), "—")).toBe("(none)");
    expect(bucketLabel(getDimension("instrument"), "XAUUSD")).toBe("XAUUSD");
    expect(bucketLabel(undefined, "x")).toBe("x");
  });
});
