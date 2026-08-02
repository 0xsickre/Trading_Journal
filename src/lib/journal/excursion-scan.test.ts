import { describe, expect, it } from "vitest";
import {
  CANDLE_INTERVALS_MS,
  scanExcursion,
  suggestInterval,
  type Candle,
} from "./excursion-scan";
import { excursionFromTrade } from "./excursion";
import type { PositionStat, TradeRow } from "./types";

const H1 = CANDLE_INTERVALS_MS.h1;

/** Hourly bars starting at `startHour` UTC on 2026-03-02 (a Monday). */
const bars = (
  startHour: number,
  rows: readonly [low: number, high: number][],
): Candle[] =>
  rows.map(([l, h], i) => ({
    t: `2026-03-02T${String(startHour + i).padStart(2, "0")}:00:00.000Z`,
    o: (l + h) / 2,
    h,
    l,
    c: (l + h) / 2,
  }));

const at = (hour: number, min = 0) =>
  `2026-03-02T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;

const base = {
  intervalMs: H1,
  isShort: false,
  openedAt: at(10),
  closedAt: at(14),
};

describe("which bars count", () => {
  it("takes the extremes of the bars inside the window", () => {
    const r = scanExcursion({
      ...base,
      // 10:00, 11:00, 12:00, 13:00 — all four sit inside 10:00–14:00.
      candles: bars(10, [
        [99, 101],
        [97, 103],
        [98, 105],
        [96, 102],
      ]),
    });
    expect(r.bars).toBe(4);
    expect(r.maePrice).toBe(96);
    expect(r.mfePrice).toBe(105);
    expect(r.fillsOnly).toBe(false);
  });

  it("refuses a bar that straddles the entry", () => {
    // THE bug this module exists to prevent. The 09:00 bar covers 09:00–10:00
    // and its low of 80 happened before the position was opened at 10:00.
    // Counting it would report a stop-threatening drawdown the trade never
    // experienced.
    const r = scanExcursion({
      ...base,
      openedAt: at(9, 30),
      candles: bars(9, [
        [80, 101],
        [97, 103],
      ]),
    });
    expect(r.maePrice).toBe(97);
    expect(r.bars).toBe(1);
    expect(r.partialBars).toBe(1);
  });

  it("refuses a bar that straddles the exit", () => {
    const r = scanExcursion({
      ...base,
      closedAt: at(12, 30),
      candles: bars(10, [
        [99, 101],
        [97, 103],
        [50, 150],
      ]),
    });
    expect(r.maePrice).toBe(97);
    expect(r.mfePrice).toBe(103);
    expect(r.partialBars).toBe(1);
  });

  it("ignores a bar with no overlap at all, without calling it partial", () => {
    // Partial means "touched the trade but hung over an edge" — a caller reads
    // it as "re-fetch finer". A bar from another day is neither.
    const r = scanExcursion({
      ...base,
      candles: [
        ...bars(3, [[10, 20]]),
        ...bars(11, [[97, 103]]),
        ...bars(20, [[10, 20]]),
      ],
    });
    expect(r.bars).toBe(1);
    expect(r.partialBars).toBe(0);
    expect(r.maePrice).toBe(97);
  });

  it("does not care what order the bars arrive in", () => {
    const ordered = scanExcursion({
      ...base,
      candles: bars(10, [
        [99, 101],
        [97, 103],
      ]),
    });
    const shuffled = scanExcursion({
      ...base,
      candles: [...bars(10, [[99, 101], [97, 103]])].reverse(),
    });
    expect(shuffled).toEqual(ordered);
  });

  it("skips a bar carrying a non-numeric price", () => {
    const bad = [
      { t: at(10), o: 100, h: Number.NaN, l: 50, c: 100 },
      ...bars(11, [[97, 103]]),
    ];
    const r = scanExcursion({ ...base, candles: bad });
    // The 50 must not become the MAE — the bar is unusable, not bearish.
    expect(r.maePrice).toBe(97);
    expect(r.bars).toBe(1);
  });
});

describe("direction", () => {
  const candles = bars(10, [
    [99, 101],
    [95, 110],
  ]);

  it("hurts a long with low prices", () => {
    const r = scanExcursion({ ...base, candles, isShort: false });
    expect(r.maePrice).toBe(95);
    expect(r.mfePrice).toBe(110);
  });

  it("mirrors both for a short", () => {
    const r = scanExcursion({ ...base, candles, isShort: true });
    expect(r.maePrice).toBe(110);
    expect(r.mfePrice).toBe(95);
  });
});

describe("the fills are observed prices too", () => {
  it("lets an exit beyond every bar set the MFE", () => {
    const r = scanExcursion({
      ...base,
      closedAt: at(12, 30),
      // The winning spike lives in the exit bar, which rule 1 discards — but
      // the fill itself proves the price was reached.
      candles: bars(10, [
        [99, 101],
        [98, 102],
      ]),
      entryPrice: 100,
      exitPrice: 120,
    });
    expect(r.mfePrice).toBe(120);
    expect(r.maePrice).toBe(98);
  });

  it("answers from the fills alone when no bar survives", () => {
    const r = scanExcursion({
      ...base,
      openedAt: at(10, 15),
      closedAt: at(10, 45),
      candles: bars(10, [[50, 150]]),
      entryPrice: 100,
      exitPrice: 104,
    });
    expect(r.fillsOnly).toBe(true);
    expect(r.bars).toBe(0);
    expect(r.partialBars).toBe(1);
    expect(r.maePrice).toBe(100);
    expect(r.mfePrice).toBe(104);
  });

  it("returns the raw extreme rather than clamping to the entry", () => {
    // Price never traded below the entry. MAE is still reported as the lowest
    // price seen; `excursionFromTrade` is what collapses a non-adverse MAE to
    // zero, and doing it twice would lose the observation.
    const r = scanExcursion({
      ...base,
      candles: bars(10, [
        [105, 110],
        [107, 112],
      ]),
      entryPrice: 100,
    });
    expect(r.maePrice).toBe(100);
    expect(r.mfePrice).toBe(112);
  });
});

describe("nothing to scan", () => {
  it("gives up on an unclosed position", () => {
    expect(scanExcursion({ ...base, closedAt: null, candles: [] }).maePrice)
      .toBeNull();
    expect(scanExcursion({ ...base, openedAt: null, candles: [] }).maePrice)
      .toBeNull();
  });

  it("gives up on a window that runs backwards", () => {
    const r = scanExcursion({
      ...base,
      openedAt: at(14),
      closedAt: at(10),
      candles: bars(10, [[99, 101]]),
      entryPrice: 100,
    });
    expect(r).toEqual({
      maePrice: null,
      mfePrice: null,
      bars: 0,
      partialBars: 0,
      coverage: 0,
      fillsOnly: false,
    });
  });

  it("gives up on a missing interval rather than dividing by zero", () => {
    expect(
      scanExcursion({ ...base, intervalMs: 0, candles: bars(10, [[99, 101]]) })
        .maePrice,
    ).toBeNull();
  });

  it("reports nulls, not zeros, when there is no data at all", () => {
    const r = scanExcursion({ ...base, candles: [] });
    expect(r.maePrice).toBeNull();
    expect(r.mfePrice).toBeNull();
  });
});

describe("coverage", () => {
  it("reaches 1 when bars fill the window", () => {
    const r = scanExcursion({
      ...base,
      candles: bars(10, [
        [99, 101],
        [99, 101],
        [99, 101],
        [99, 101],
      ]),
    });
    expect(r.coverage).toBe(1);
  });

  it("falls when the feed has a hole", () => {
    // Two of four hours present. A weekend does exactly this and is not an
    // error — which is why coverage is a hint and never a verdict.
    const r = scanExcursion({
      ...base,
      candles: [...bars(10, [[99, 101]]), ...bars(13, [[99, 101]])],
    });
    expect(r.coverage).toBeCloseTo(0.5, 9);
  });
});

describe("capture % can never exceed 100", () => {
  // The guarantee rule 2 exists for, proven end to end through the module that
  // consumes these prices.
  const stats = (over: Partial<PositionStat>): PositionStat =>
    ({
      position_id: "p1",
      avg_entry: 100,
      avg_exit: 120,
      entry_qty: 1,
      exit_qty: 1,
      gross_pl: 20,
      net_pl: 20,
      total_fees: 0,
      total_swap: 0,
      realized_r: 4,
      realized_r_net: 4,
      opened_at: at(10),
      closed_at: at(12, 30),
      duration_seconds: 9000,
      point_value: 1,
      tick_size: 0.01,
      point_value_source: "instrument",
      ...over,
    }) as PositionStat;

  it("holds when the best price of the trade was the exit itself", () => {
    const scan = scanExcursion({
      ...base,
      closedAt: at(12, 30),
      // Every surviving bar tops out at 102 — well under the 120 exit, which
      // landed in the discarded boundary bar.
      candles: bars(10, [
        [99, 101],
        [98, 102],
      ]),
      entryPrice: 100,
      exitPrice: 120,
    });

    const row: TradeRow = {
      id: "p1",
      account_id: "a1",
      trade_no: 1,
      status: "closed",
      source: "manual",
      needs_review: false,
      created_at: at(10),
      stats: stats({}),
      direction: "Long",
      entry_price: 100,
      // 1R = 5 points, so the 120 exit is +4R.
      stop_price: 95,
      max_drawdown_price: scan.maePrice,
      max_profit_price: scan.mfePrice,
    };

    const e = excursionFromTrade(row);
    expect(e.mfeR).toBe(4);
    expect(e.capturePct).toBe(100);
    expect(e.capturePct!).toBeLessThanOrEqual(100);
  });

  it("would break without the exit fill — pinning why rule 2 exists", () => {
    // Same trade, fills withheld. MFE comes back as 102 = 0.4R against a
    // realized 4R, and capture reads 1000%: "I kept ten times what was
    // available". This test documents the failure the guarantee prevents.
    const scan = scanExcursion({
      ...base,
      closedAt: at(12, 30),
      candles: bars(10, [
        [99, 101],
        [98, 102],
      ]),
    });

    const row: TradeRow = {
      id: "p1",
      account_id: "a1",
      trade_no: 1,
      status: "closed",
      source: "manual",
      needs_review: false,
      created_at: at(10),
      stats: stats({}),
      direction: "Long",
      entry_price: 100,
      stop_price: 95,
      max_drawdown_price: scan.maePrice,
      max_profit_price: scan.mfePrice,
    };

    expect(excursionFromTrade(row).capturePct).toBeGreaterThan(100);
  });
});

describe("suggestInterval", () => {
  const HOUR = 3_600_000;

  it("scales the bar to the hold", () => {
    expect(suggestInterval(30 * 60_000)).toBe("m1");
    expect(suggestInterval(6 * HOUR)).toBe("m5");
    expect(suggestInterval(2 * 24 * HOUR)).toBe("m15");
    expect(suggestInterval(7 * 24 * HOUR)).toBe("m30");
    expect(suggestInterval(40 * 24 * HOUR)).toBe("h1");
  });

  it("never goes coarser than an hour", () => {
    // A month-long swing on daily bars would lose two whole DAYS to the
    // discarded boundary bars. Hourly bars find the same extreme.
    expect(suggestInterval(365 * 24 * HOUR)).toBe("h1");
  });

  it("falls back rather than throwing on a missing duration", () => {
    expect(suggestInterval(0)).toBe("m5");
    expect(suggestInterval(Number.NaN)).toBe("m5");
  });
});

describe("a candle with an unreadable timestamp is skipped", () => {
  it("does not let a bad bar's extremes into the answer", () => {
    const r = scanExcursion({
      ...base,
      candles: [
        { t: "not a time", o: 100, h: 999, l: 1, c: 100 },
        ...bars(11, [[97, 103]]),
      ],
    });
    // The 1 and the 999 must not become MAE and MFE.
    expect(r.maePrice).toBe(97);
    expect(r.mfePrice).toBe(103);
    expect(r.bars).toBe(1);
  });
});
