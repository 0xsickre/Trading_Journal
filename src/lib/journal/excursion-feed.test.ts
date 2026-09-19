import { describe, expect, it } from "vitest";
import { DUKASCOPY_INSTRUMENTS, minuteCandleUrl, parseMinuteCandles, utcDayStart, type FeedCandle } from "./dukascopy";
import { excursionFromFeed, inferBarMs, type FeedFill } from "./excursion-feed";
import { excursionSourcePatch } from "./excursion-source";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2018, 2, 7, 14, 0); // 7 Mar 2018 14:00 UTC — 09:00 New York

/** A flat minute at `price`, spanning ±spread. */
const bar = (t: number, price: number, spread = 0.1): FeedCandle => ({
  t, o: price, c: price, l: price - spread, h: price + spread,
});

/**
 * A long XAUUSD trade on a 4-hour chart: entry 1327.45 stamped 14:00 (bar open),
 * filled at 15:10; price dips to 1322, runs to 1331, exits 1317.62 stamped
 * 22:00 next day, filled at 23:30. Built so every number below is checkable by
 * hand.
 */
function goldTrade(basis = 0) {
  const candles: FeedCandle[] = [];
  const at = (t: number, p: number) => candles.push(bar(t, p - basis));
  for (let m = 0; m < 70; m++) at(T0 + m * MIN, 1330);          // 14:00–15:09, above the limit
  at(T0 + 70 * MIN, 1327.45);                                     // 15:10 the fill
  for (let m = 71; m < 200; m++) at(T0 + m * MIN, 1325);
  at(T0 + 200 * MIN, 1322);                                       // the worst of it
  for (let m = 201; m < 400; m++) at(T0 + m * MIN, 1328);
  at(T0 + 400 * MIN, 1331);                                       // the best of it
  const exitBar = T0 + 32 * HOUR;                                 // 22:00 next day
  for (let t = T0 + 401 * MIN; t < exitBar + 90 * MIN; t += MIN) at(t, 1320);
  at(exitBar + 90 * MIN, 1317.62);                                // 23:30 the exit
  for (let m = 91; m < 240; m++) at(exitBar + m * MIN, 1300);    // after the exit — never counted
  const fills: FeedFill[] = [
    { side: "entry", price: 1327.45, at: T0 },
    { side: "exit", price: 1317.62, at: exitBar },
  ];
  return { candles, fills };
}

describe("the bar a fill time was snapped to", () => {
  it("reads a 4-hour grid off fills 32 hours apart", () => {
    expect(inferBarMs([T0, T0 + 32 * HOUR])).toBe(4 * HOUR);
  });
  it("reads a 1-hour grid off fills an hour apart", () => {
    expect(inferBarMs([T0, T0 + HOUR])).toBe(HOUR);
  });
  it("reads minutes off typed times that share nothing coarser", () => {
    expect(inferBarMs([T0, T0 + 136 * MIN])).toBe(MIN);
  });
});

describe("MAE/MFE from a feed that is not the broker", () => {
  it("finds the extremes between the fill minutes, not the bar opens", () => {
    const { candles, fills } = goldTrade();
    const r = excursionFromFeed({ fills, isShort: false, candles });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Worst: the exit itself, 1317.62 — lower than the 1321.9 dip, and a price
    // the position certainly saw. Best: 1331 + 0.1. The 1330s before the fill
    // and the 1300s after the exit are outside the position and not counted.
    expect(r.maePrice).toBeCloseTo(1317.62, 6);
    expect(r.mfePrice).toBeCloseTo(1331.1, 6);
    expect(r.from).toBe(T0 + 70 * MIN);
    expect(r.barMs).toBe(4 * HOUR);
    // The feed matches the broker here, so no difference is invented.
    expect(r.basis).toBe(0);
  });

  it("measures a real difference when the fills prove one — a feed $3 lower", () => {
    // Minute-exact fills (a typed or MT5 trade), so the bars are narrow and the
    // difference is pinned to within the spread.
    const { candles } = goldTrade(3);
    const fills: FeedFill[] = [
      { side: "entry", price: 1327.45, at: T0 + 70 * MIN },
      { side: "exit", price: 1317.62, at: T0 + 32 * HOUR + 90 * MIN },
    ];
    const r = excursionFromFeed({ fills, isShort: false, candles });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.basis).toBeGreaterThan(2.8);
    expect(r.basis).toBeLessThanOrEqual(3.1);
    expect(r.mfePrice).toBeCloseTo(1331.1 - 3 + r.basis, 6);
  });

  it("swaps the extremes for a short", () => {
    const { candles, fills } = goldTrade();
    const shortFills = fills.map((f) => ({ ...f, side: f.side }));
    const r = excursionFromFeed({ fills: shortFills, isShort: true, candles });
    // Short: the high is against it, the low — here the exit — in its favour.
    expect(r.ok && r.maePrice).toBeCloseTo(1331.1, 6);
    expect(r.ok && r.mfePrice).toBeCloseTo(1317.62, 6);
  });

  it("REFUSES fills that match no market at those times — the timezone error it exists to catch", () => {
    // The same trade with every fill six hours early: 08:00 instead of 14:00,
    // Belgrade read where New York was meant. Gold traded ~1333 then.
    const { candles } = goldTrade();
    const early = [
      { side: "entry" as const, price: 1327.45, at: T0 - 6 * HOUR },
      { side: "exit" as const, price: 1317.62, at: T0 + 26 * HOUR },
    ];
    for (let m = 0; m < 240; m++) candles.push(bar(T0 - 6 * HOUR + m * MIN, 1333));
    const r = excursionFromFeed({ fills: early, isShort: false, candles });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/timezone/);
  });

  it("refuses an open trade and a bar with no market in it", () => {
    const { candles } = goldTrade();
    expect(excursionFromFeed({ fills: [{ side: "entry", price: 1327.45, at: T0 }], isShort: false, candles }).ok).toBe(false);
    const r = excursionFromFeed({
      fills: [
        { side: "entry", price: 1327.45, at: T0 },
        { side: "exit", price: 1317.62, at: T0 + 400 * HOUR },
      ],
      isShort: false,
      candles,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no market data/);
  });
});

describe("the two guards against a confident wrong answer", () => {
  it("refuses a difference no two brokers have — the wrong-timezone trade that still 'fit'", () => {
    // Measured on the real #5 read as Belgrade time: a 4-hour bar is wide enough
    // that a $3.13 difference makes the fills fit. No two gold quotes differ by
    // $3, so it is refused with the timezone named.
    const { candles, fills } = goldTrade(3.5);
    const r = excursionFromFeed({ fills, isShort: false, candles, maxBasis: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/timezone/);
  });

  it("refuses when the difference cannot be pinned down well enough to trust the extremes", () => {
    // A one-hour trade on a feed a few cents off, as on real copper: the bars
    // allow a difference range wider than a quarter of the whole move.
    const t0 = Date.UTC(2023, 8, 20, 18);
    const candles: FeedCandle[] = [];
    for (let m = 0; m < 60; m++) candles.push(bar(t0 + m * MIN, 3.751 + (m % 15) * 0.001, 0.0005));
    for (let m = 60; m < 120; m++) candles.push(bar(t0 + m * MIN, 3.737 + (m % 20) * 0.001, 0.0005));
    const r = excursionFromFeed({
      fills: [
        { side: "entry", price: 3.7306, at: t0 },
        { side: "exit", price: 3.71195, at: t0 + HOUR },
      ],
      isShort: false,
      candles,
      maxBasis: 0.06,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cannot pin down/);
  });
});

describe("the Dukascopy day file", () => {
  it("puts the month ZERO-based in the path — March is 02", () => {
    expect(minuteCandleUrl("XAUUSD", Date.UTC(2018, 2, 7))).toBe(
      "https://datafeed.dukascopy.com/datafeed/XAUUSD/2018/02/07/BID_candles_min_1.bi5",
    );
  });

  it("reads 24-byte records at the instrument's scale and drops minutes that did not trade", () => {
    const day = Date.UTC(2018, 2, 7);
    const buf = new ArrayBuffer(48);
    const v = new DataView(buf);
    // 14:00 — open 1331.242, close 1331.391, low 1331.229, high 1331.442, volume 3.5
    [50400, 1331242, 1331391, 1331229, 1331442].forEach((n, i) => v.setUint32(i * 4, n));
    v.setFloat32(20, 3.5);
    // 14:01 — a carried-over price with zero volume
    [50460, 1331391, 1331391, 1331391, 1331391].forEach((n, i) => v.setUint32(24 + i * 4, n));
    v.setFloat32(44, 0);
    const out = parseMinuteCandles(new Uint8Array(buf), day, DUKASCOPY_INSTRUMENTS.XAUUSD.scale);
    expect(out).toEqual([
      { t: day + 50400_000, o: 1331.242, c: 1331.391, l: 1331.229, h: 1331.442 },
    ]);
  });

  it("maps only the instruments whose scale was checked against real prices", () => {
    expect(Object.keys(DUKASCOPY_INSTRUMENTS).sort()).toEqual(["HG", "NAS100", "XAUUSD", "XCUUSD"]);
    expect(utcDayStart(Date.UTC(2018, 2, 7, 23, 59))).toBe(Date.UTC(2018, 2, 7));
  });
});

describe("who wrote the MAE/MFE after a save", () => {
  const prev = { max_drawdown_price: 1321.9, max_profit_price: 1331.1 };

  it("a save that did not change them says nothing — an automatic value survives", () => {
    expect(excursionSourcePatch({ max_drawdown_price: 1321.9, max_profit_price: 1331.1 }, prev)).toEqual({});
    expect(excursionSourcePatch({ thesis: "x" }, prev)).toEqual({});
  });

  it("a changed value is the trader's, and marked manual", () => {
    expect(excursionSourcePatch({ max_drawdown_price: 1320, max_profit_price: 1331.1 }, prev)).toEqual({
      excursion_source: "manual",
    });
  });

  it("clearing both hands the trade back to the automatic fill", () => {
    expect(excursionSourcePatch({ max_drawdown_price: null, max_profit_price: "" }, prev)).toEqual({
      excursion_source: null,
    });
  });

  it("a new trade typed with a value is manual from the start", () => {
    expect(excursionSourcePatch({ max_profit_price: 1331 }, null)).toEqual({ excursion_source: "manual" });
  });
});
