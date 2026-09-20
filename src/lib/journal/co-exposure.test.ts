import { describe, expect, it } from "vitest";
import {
  dailyPnlByInstrument,
  fisherInterval,
  instrumentPairs,
  MIN_SHARED_DAYS,
  pearson,
  spansOf,
} from "./co-exposure";
import type { TradeRow } from "./types";

const row = (
  instrument: string,
  openedAt: string,
  closedAt: string | null,
  net: number | null = 100,
): TradeRow =>
  ({
    id: `${instrument}-${openedAt}`,
    account_id: "acc-1",
    instrument,
    status: closedAt ? "closed" : "open",
    stats: { opened_at: openedAt, closed_at: closedAt, net_pl: net },
  }) as unknown as TradeRow;

const tzOf = () => "UTC";
const netOf = (r: TradeRow) => r.stats?.net_pl ?? null;

describe("spansOf", () => {
  it("runs an open position up to today, because the exposure is still on", () => {
    const [span] = spansOf([row("XAUUSD", "2026-03-02T09:00:00Z", null)], tzOf, "2026-03-06");
    expect(span.openDay).toBe("2026-03-02");
    expect(span.closeDay).toBe("2026-03-06");
  });

  it("ignores a position with no entry instant — it was never exposed", () => {
    const planned = { id: "p", instrument: "XAUUSD", stats: { opened_at: null } } as unknown as TradeRow;
    expect(spansOf([planned], tzOf, "2026-03-06")).toEqual([]);
  });
});

describe("pearson — pairwise complete, never zero-filled", () => {
  it("finds a perfect positive and a perfect negative relationship", () => {
    const a = new Map([
      ["d1", 1],
      ["d2", 2],
      ["d3", 3],
    ]);
    expect(pearson(a, new Map([["d1", 2], ["d2", 4], ["d3", 6]]))!.r).toBeCloseTo(1, 10);
    expect(pearson(a, new Map([["d1", -2], ["d2", -4], ["d3", -6]]))!.r).toBeCloseTo(-1, 10);
  });

  it("uses only the days both series have — absent days are not zeros", () => {
    const a = new Map([
      ["d1", 1],
      ["d2", 2],
      ["d3", 3],
    ]);
    const b = new Map([
      ["d2", 4],
      ["d3", 6],
      ["d9", 99],
    ]);
    expect(pearson(a, b)!.n).toBe(2);
  });

  it("is undefined rather than zero when one series never moved", () => {
    const flat = new Map([["d1", 5], ["d2", 5], ["d3", 5]]);
    const moving = new Map([["d1", 1], ["d2", 2], ["d3", 3]]);
    expect(pearson(flat, moving)).toBeNull();
  });

  it("needs two shared days before it says anything", () => {
    expect(pearson(new Map([["d1", 1]]), new Map([["d1", 2]]))).toBeNull();
  });
});

describe("fisherInterval", () => {
  it("brackets the coefficient, asymmetrically, and stays inside ±1", () => {
    const ci = fisherInterval(0.8, 12)!;
    expect(ci.lo).toBeLessThan(0.8);
    expect(ci.hi).toBeGreaterThan(0.8);
    expect(ci.hi).toBeLessThanOrEqual(1);
    // Skewed: the room below 0.8 is larger than the room above it.
    expect(0.8 - ci.lo).toBeGreaterThan(ci.hi - 0.8);
  });

  it("narrows as the sample grows", () => {
    const small = fisherInterval(0.6, 8)!;
    const large = fisherInterval(0.6, 80)!;
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("refuses a sample too small for the transform", () => {
    expect(fisherInterval(0.9, 3)).toBeNull();
  });
});

describe("instrumentPairs", () => {
  /** Gold and the index held side by side for a week; copper alone, later. */
  const rows = [
    row("XAUUSD", "2026-03-02T09:00:00Z", "2026-03-09T15:00:00Z"),
    row("US100.cash", "2026-03-03T09:00:00Z", "2026-03-06T15:00:00Z"),
    row("XCUUSD", "2026-04-06T09:00:00Z", "2026-04-08T15:00:00Z"),
  ];

  it("counts the days two instruments were open together", () => {
    const pairs = instrumentPairs(spansOf(rows, tzOf, "2026-04-10"), new Map());
    const goldIndex = pairs.find((p) => p.a === "US100.cash" && p.b === "XAUUSD")!;
    // 3 Mar to 6 Mar inclusive.
    expect(goldIndex.overlapDays).toBe(4);
    const goldCopper = pairs.find((p) => p.b === "XCUUSD" && p.a === "XAUUSD")!;
    expect(goldCopper.overlapDays).toBe(0);
  });

  it("puts the pairs held together most often first", () => {
    const pairs = instrumentPairs(spansOf(rows, tzOf, "2026-04-10"), new Map());
    expect(pairs[0].overlapDays).toBeGreaterThanOrEqual(pairs[pairs.length - 1].overlapDays);
  });

  it("withholds a coefficient below the shared-day gate, and says how many it had", () => {
    const pnl = new Map([
      ["XAUUSD", new Map([["2026-03-09", 100], ["2026-03-10", -50]])],
      ["US100.cash", new Map([["2026-03-09", 80], ["2026-03-10", -40]])],
    ]);
    const pair = instrumentPairs(spansOf(rows, tzOf, "2026-04-10"), pnl).find(
      (p) => p.a === "US100.cash" && p.b === "XAUUSD",
    )!;
    expect(pair.sharedCloseDays).toBe(2);
    expect(pair.sharedCloseDays).toBeLessThan(MIN_SHARED_DAYS);
    expect(pair.correlation).toBeNull();
    expect(pair.correlationLo).toBeNull();
  });

  it("reports the coefficient with its interval once there are enough days", () => {
    const days = ["03-02", "03-03", "03-04", "03-05", "03-06", "03-09"];
    const pnl = new Map([
      ["XAUUSD", new Map(days.map((d, i) => [`2026-${d}`, (i - 2) * 100]))],
      ["US100.cash", new Map(days.map((d, i) => [`2026-${d}`, (i - 2) * 70 + 10]))],
    ]);
    const pair = instrumentPairs(spansOf(rows, tzOf, "2026-04-10"), pnl).find(
      (p) => p.a === "US100.cash" && p.b === "XAUUSD",
    )!;
    expect(pair.sharedCloseDays).toBe(6);
    expect(pair.correlation).toBeCloseTo(1, 6);
    expect(pair.correlationLo).not.toBeNull();
    expect(pair.correlationHi).toBeLessThanOrEqual(1);
  });

  it("has no pairs at all with one instrument", () => {
    expect(instrumentPairs(spansOf([rows[0]], tzOf, "2026-03-10"), new Map())).toEqual([]);
  });
});

describe("dailyPnlByInstrument", () => {
  it("sums a day's closes per instrument, on the account's clock", () => {
    const out = dailyPnlByInstrument(
      [
        row("XAUUSD", "2026-03-02T09:00:00Z", "2026-03-09T12:00:00Z", 100),
        row("XAUUSD", "2026-03-03T09:00:00Z", "2026-03-09T15:00:00Z", -30),
      ],
      tzOf,
      netOf,
    );
    expect(out.get("XAUUSD")!.get("2026-03-09")).toBe(70);
  });

  it("leaves out what is still open and what has no money yet", () => {
    const out = dailyPnlByInstrument(
      [
        row("XAUUSD", "2026-03-02T09:00:00Z", null, null),
        row("XCUUSD", "2026-03-02T09:00:00Z", "2026-03-04T12:00:00Z", null),
      ],
      tzOf,
      netOf,
    );
    expect(out.size).toBe(0);
  });
});
