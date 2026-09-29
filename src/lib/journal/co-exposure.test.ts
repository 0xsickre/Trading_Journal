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

const NOW = Date.parse("2026-09-29T15:00:00Z");

describe("spansOf", () => {
  it("runs an open position up to now, because the exposure is still on", () => {
    const [span] = spansOf([row("MNQ", "2026-09-29T14:00:00Z", null)], NOW);
    expect(span.from).toBe(Date.parse("2026-09-29T14:00:00Z"));
    expect(span.to).toBe(NOW);
  });

  it("ignores a position with no entry instant — it was never exposed", () => {
    const planned = { id: "p", instrument: "MNQ", stats: { opened_at: null } } as unknown as TradeRow;
    expect(spansOf([planned], NOW)).toEqual([]);
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

describe("instrumentPairs — held together, in minutes (F5.5)", () => {
  /** NQ and ES in the same morning; CL alone, in the afternoon. */
  const rows = [
    row("NQ", "2026-09-29T13:35:00Z", "2026-09-29T14:05:00Z"),
    row("ES", "2026-09-29T13:50:00Z", "2026-09-29T14:20:00Z"),
    row("CL", "2026-09-29T17:00:00Z", "2026-09-29T17:10:00Z"),
  ];

  it("counts the minutes two instruments were open together", () => {
    const pairs = instrumentPairs(spansOf(rows, NOW), new Map());
    const nqEs = pairs.find((p) => p.a === "ES" && p.b === "NQ")!;
    // 13:50 to 14:05.
    expect(nqEs.overlapMinutes).toBe(15);
    expect([nqEs.aMinutes, nqEs.bMinutes]).toEqual([30, 30]);
    expect(pairs.find((p) => p.a === "CL" && p.b === "NQ")!.overlapMinutes).toBe(0);
  });

  it("does not count one instrument twice when two of its positions overlap", () => {
    const twice = [...rows, row("NQ", "2026-09-29T13:40:00Z", "2026-09-29T13:55:00Z")];
    const nqEs = instrumentPairs(spansOf(twice, NOW), new Map()).find((p) => p.a === "ES" && p.b === "NQ")!;
    expect(nqEs.overlapMinutes).toBe(15);
    expect(nqEs.bMinutes).toBe(30);
  });

  it("puts the pairs held together longest first", () => {
    const pairs = instrumentPairs(spansOf(rows, NOW), new Map());
    expect(pairs[0]).toMatchObject({ a: "ES", b: "NQ" });
  });

  it("withholds a coefficient below the shared-day gate, and says how many it had", () => {
    const pnl = new Map([
      ["NQ", new Map([["2026-03-09", 100], ["2026-03-10", -50]])],
      ["ES", new Map([["2026-03-09", 80], ["2026-03-10", -40]])],
    ]);
    const pair = instrumentPairs(spansOf(rows, NOW), pnl).find((p) => p.a === "ES" && p.b === "NQ")!;
    expect(pair.sharedCloseDays).toBe(2);
    expect(pair.sharedCloseDays).toBeLessThan(MIN_SHARED_DAYS);
    expect(pair.correlation).toBeNull();
    expect(pair.correlationLo).toBeNull();
  });

  it("reports the coefficient with its interval once there are enough days", () => {
    const days = ["03-02", "03-03", "03-04", "03-05", "03-06", "03-09"];
    const pnl = new Map([
      ["NQ", new Map(days.map((d, i) => [`2026-${d}`, (i - 2) * 100]))],
      ["ES", new Map(days.map((d, i) => [`2026-${d}`, (i - 2) * 70 + 10]))],
    ]);
    const pair = instrumentPairs(spansOf(rows, NOW), pnl).find((p) => p.a === "ES" && p.b === "NQ")!;
    expect(pair.sharedCloseDays).toBe(6);
    expect(pair.correlation).toBeCloseTo(1, 6);
    expect(pair.correlationLo).not.toBeNull();
    expect(pair.correlationHi).toBeLessThanOrEqual(1);
  });

  it("has no pairs at all with one instrument", () => {
    expect(instrumentPairs(spansOf([rows[0]], NOW), new Map())).toEqual([]);
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
