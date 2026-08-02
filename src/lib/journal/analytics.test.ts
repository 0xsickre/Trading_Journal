import { describe, expect, it } from "vitest";
import {
  breakdownByField,
  computeStats,
  toRealized,
  weeklyExitEfficiency,
  weeklySlippageR,
} from "./analytics";
import type { TradeRow } from "./types";

function trade(
  partial: Partial<TradeRow> & {
    id: string;
    status: string;
    net_pl: number;
    realized_r?: number | null;
  },
): TradeRow {
  const { net_pl, realized_r, ...rest } = partial;
  return {
    account_id: null,
    trade_no: null,
    source: "manual",
    needs_review: false,
    created_at: "2026-01-01T00:00:00Z",
    ...rest,
    stats: {
      position_id: partial.id,
      avg_entry: null,
      avg_exit: null,
      entry_qty: 1,
      exit_qty: 1,
      gross_pl: net_pl,
      net_pl,
      total_fees: 0,
      total_swap: 0,
      realized_r: realized_r ?? null,
      realized_r_net: null,
      opened_at: "2026-01-01T00:00:00Z",
      closed_at: partial.status === "closed" ? "2026-01-02T00:00:00Z" : null,
      duration_seconds: null,
      point_value: 1,
      tick_size: null,
      point_value_source: "snapshot",
    },
  };
}

describe("toRealized", () => {
  it("excludes partial by default", () => {
    const trades = [
      trade({ id: "a", status: "closed", net_pl: 100, realized_r: 1 }),
      trade({ id: "b", status: "partial", net_pl: 50, realized_r: 0.5 }),
    ];
    expect(toRealized(trades)).toHaveLength(1);
    expect(toRealized(trades)[0].id).toBe("a");
  });

  it("includes partial when opted in", () => {
    const trades = [
      trade({ id: "b", status: "partial", net_pl: 50, realized_r: 0.5 }),
    ];
    expect(toRealized(trades, { includePartial: true })).toHaveLength(1);
  });
});

describe("computeStats", () => {
  it("profit factor and win rate on closed trades", () => {
    const trades = toRealized([
      trade({ id: "w", status: "closed", net_pl: 200, realized_r: 2 }),
      trade({ id: "l", status: "closed", net_pl: -100, realized_r: -1 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.winRate).toBe(50);
    expect(s.profitFactor).toBe(2);
    expect(s.totalR).toBe(1);
  });

  it("avgWin/avgLoss only from trades with valid R", () => {
    const trades = toRealized([
      trade({ id: "w1", status: "closed", net_pl: 100, realized_r: 2 }),
      trade({ id: "w2", status: "closed", net_pl: 50, realized_r: null }),
      trade({ id: "l1", status: "closed", net_pl: -100, realized_r: -1 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.wins).toBe(2);
    expect(s.avgWinR).toBe(2);
    expect(s.avgLossR).toBe(-1);
    // 2W / 1L by money, but only w1 and l1 carry an R. Expectancy is in R, so
    // it is computed over that population alone: 0.5 × 2R + 0.5 × -1R.
    // Weighting by the money win rate (66.7%) would blend two samples and
    // credit w2's win probability against an average it never contributed to.
    expect(s.expectancySample).toBe(2);
    expect(s.expectancy).toBeCloseTo(0.5);
  });

  it("max drawdown on cumulative net", () => {
    const trades = toRealized([
      trade({ id: "1", status: "closed", net_pl: 100, realized_r: 1 }),
      trade({ id: "2", status: "closed", net_pl: -150, realized_r: -1.5 }),
      trade({ id: "3", status: "closed", net_pl: 50, realized_r: 0.5 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.maxDrawdown).toBe(-150);
  });
});

describe("profit factor and the money/R split", () => {
  it("reports Infinity — not null — when there are no losses", () => {
    const trades = toRealized([
      trade({ id: "w1", status: "closed", net_pl: 100, realized_r: 1 }),
      trade({ id: "w2", status: "closed", net_pl: 200, realized_r: 2 }),
    ]);
    const s = computeStats(trades, "net");
    expect(s.profitFactor).toBe(Infinity);
  });

  it("reports null only when there is nothing to divide", () => {
    expect(computeStats([], "net").profitFactor).toBeNull();
  });

  it("separates average win in R from average win in money", () => {
    // w2 has no stop, so no R. Money averages cover both winners; R averages
    // cover only the one that has an R.
    const trades = toRealized([
      trade({ id: "w1", status: "closed", net_pl: 100, realized_r: 2 }),
      trade({ id: "w2", status: "closed", net_pl: 300, realized_r: null }),
      trade({ id: "l1", status: "closed", net_pl: -100, realized_r: -1 }),
    ]);
    const s = computeStats(trades, "net");

    expect(s.avgWinMoney).toBe(200);
    expect(s.avgLossMoney).toBe(-100);
    expect(s.avgWinR).toBe(2);
    expect(s.avgLossR).toBe(-1);
    // The two ratios genuinely differ; the score's band table wants the money one.
    expect(s.avgWinMoney / Math.abs(s.avgLossMoney)).toBe(2);
    expect(s.avgWinR / Math.abs(s.avgLossR)).toBe(2);
    expect(s.expectancySample).toBe(2);
  });
});

describe("breakdownByField", () => {
  // Pins the behaviour that existed before this function became a wrapper over
  // the report engine. Nothing on screen may move as a result of that swap.
  const book = () =>
    toRealized([
      trade({
        id: "a",
        status: "closed",
        net_pl: 200,
        realized_r: 2,
        setup_grade: "A",
        technical_tags: ["Sweep", "FVG"],
      } as never),
      trade({
        id: "b",
        status: "closed",
        net_pl: -100,
        realized_r: -1,
        setup_grade: "B",
        technical_tags: ["FVG"],
      } as never),
      trade({
        id: "c",
        status: "closed",
        net_pl: 50,
        realized_r: 0.5,
        setup_grade: "A",
        technical_tags: [],
      } as never),
    ]);

  it("groups a scalar column and sorts by net, descending", () => {
    const rows = breakdownByField(book(), "setup_grade");
    expect(rows.map((r) => [r.key, r.count, r.netSum])).toEqual([
      ["A", 2, 250],
      ["B", 1, -100],
    ]);
  });

  it("computes win rate, total R and average R per group", () => {
    const rows = breakdownByField(book(), "setup_grade");
    const a = rows.find((r) => r.key === "A")!;
    expect(a.winRate).toBe(100);
    expect(a.totalR).toBe(2.5);
    expect(a.avgR).toBe(1.25);
  });

  it("puts a tagged trade in every tag it carries", () => {
    const rows = breakdownByField(book(), "technical_tags");
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.count]));
    expect(byKey).toEqual({ Sweep: 1, FVG: 2, "—": 1 });
  });

  it("buckets a missing value under the em dash", () => {
    const rows = breakdownByField(
      toRealized([
        trade({ id: "x", status: "closed", net_pl: 10, realized_r: 0.1 } as never),
      ]),
      "setup_grade",
    );
    expect(rows.map((r) => r.key)).toEqual(["—"]);
  });

  it("does NOT normalize direction — that is the registry's behaviour, opted into", () => {
    const rows = breakdownByField(
      toRealized([
        trade({
          id: "x",
          status: "closed",
          net_pl: 10,
          realized_r: 0.1,
          direction: "Short (sell)",
        } as never),
      ]),
      "direction",
    );
    expect(rows.map((r) => r.key)).toEqual(["Short (sell)"]);
  });

  it("returns nothing for an empty book", () => {
    expect(breakdownByField([], "setup_grade")).toEqual([]);
  });
});

describe("drawdown covers the same trades as the money sums", () => {
  // buildBalanceTimeline drops any point with a falsy `at`, so a realized trade
  // with no close instant counted toward netSum and profitFactor but was
  // invisible to maxDrawdown — the parts stopped adding up, in the direction
  // that flatters the book.
  const orphan = (id: string, net: number) => {
    const row = trade({ id, status: "closed", net_pl: net });
    row.stats!.closed_at = null;
    return row;
  };

  it("counts a loss with no close timestamp in the drawdown", () => {
    const realized = toRealized([
      trade({ id: "win", status: "closed", net_pl: 500 }),
      orphan("no-close", -300),
    ]);
    const s = computeStats(realized);
    expect(s.count).toBe(2);
    expect(s.netSum).toBe(200);
    // The orphan sorts first (no instant), so the curve runs -300 then +200:
    // peak 0, trough -300.
    expect(s.maxDrawdown).toBe(-300);
  });

  it("keeps drawdown at zero for a book that only ever went up", () => {
    const s = computeStats(
      toRealized([
        orphan("a", 100),
        trade({ id: "b", status: "closed", net_pl: 50 }),
      ]),
    );
    expect(s.netSum).toBe(150);
    expect(s.maxDrawdown).toBe(0);
  });
});

describe("weekly aggregates attribute to the ACCOUNT's week", () => {
  /**
   * `weeklySlippageR` and `weeklyExitEfficiency` had zero coverage — two
   * exported functions doing timezone-dependent bucketing, which is the exact
   * class of mistake this codebase has already been bitten by twice.
   *
   * Both need a planned entry that differs from the fill (slippage) and a
   * target that the exit fell short of (exit efficiency), so the rows are built
   * with the plan columns rather than the bare helper above.
   */
  const planned = (
    id: string,
    closedAt: string,
    over: Partial<TradeRow> = {},
  ): TradeRow => ({
    id,
    account_id: null,
    trade_no: null,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: "2026-03-01T00:00:00Z",
    direction: "Long",
    entry_price: 100,
    stop_price: 95,
    target_price: 115,
    ...over,
    stats: {
      position_id: id,
      avg_entry: 101, // one point of adverse slippage against the plan
      avg_exit: 110,
      entry_qty: 1,
      exit_qty: 1,
      gross_pl: 900,
      net_pl: 900,
      total_fees: 0,
      total_swap: 0,
      realized_r: 1.8,
      realized_r_net: 1.8,
      opened_at: "2026-03-02T14:00:00Z",
      closed_at: closedAt,
      duration_seconds: 3600,
      point_value: 1,
      tick_size: null,
      point_value_source: "snapshot",
    },
  });

  const NY = () => "America/New_York";
  const BG = () => "Europe/Belgrade";

  it("buckets by the Monday of the closing week", () => {
    const rows = toRealized([
      planned("a", "2026-03-03T15:00:00Z"), // Tue, week of Mar 2
      planned("b", "2026-03-05T15:00:00Z"), // Thu, same week
      planned("c", "2026-03-10T15:00:00Z"), // Tue, week of Mar 9
    ]);

    const slip = weeklySlippageR(rows, NY);
    expect(slip.map((w) => w.week)).toEqual(["2026-03-02", "2026-03-09"]);
    expect(slip.map((w) => w.tradeCount)).toEqual([2, 1]);

    const eff = weeklyExitEfficiency(rows, NY);
    expect(eff.map((w) => w.week)).toEqual(["2026-03-02", "2026-03-09"]);
    expect(eff.map((w) => w.tradeCount)).toEqual([2, 1]);
  });

  it("puts a Monday-02:00-UTC close in the PREVIOUS week for New York", () => {
    // Still Sunday evening in New York, so it belongs to the week before — the
    // whole reason these functions take a `tzOf` rather than reading UTC.
    const rows = toRealized([planned("a", "2026-03-09T02:00:00Z")]);
    expect(weeklySlippageR(rows, NY)[0].week).toBe("2026-03-02");
    expect(weeklySlippageR(rows, BG)[0].week).toBe("2026-03-09");
  });

  it("returns rows sorted by week, whatever order the trades arrive in", () => {
    const rows = toRealized([
      planned("late", "2026-03-17T15:00:00Z"),
      planned("early", "2026-03-03T15:00:00Z"),
    ]);
    expect(weeklySlippageR(rows, NY).map((w) => w.week)).toEqual([
      "2026-03-02",
      "2026-03-16",
    ]);
  });

  it("skips a trade with no usable measurement instead of averaging a zero", () => {
    // No stop price → no R denominator → no slippage in R. The week must not
    // appear at all rather than appear with a 0 that reads as "no slippage".
    const rows = toRealized([
      planned("no-stop", "2026-03-03T15:00:00Z", { stop_price: null }),
    ]);
    expect(weeklySlippageR(rows, NY)).toEqual([]);
  });

  it("returns nothing for an empty book", () => {
    expect(weeklySlippageR([], NY)).toEqual([]);
    expect(weeklyExitEfficiency([], NY)).toEqual([]);
  });
});
