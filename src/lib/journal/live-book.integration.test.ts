import { describe, expect, it } from "vitest";
import { computeStats, dailyPnl, toRealized } from "./analytics";
import { resolveBreakevenRange, type BreakevenConfig } from "./breakeven";
import { unpricedClosedCount } from "./money-provenance";
import { narrowPositionStat } from "./types";
import { openPositionsOn } from "./open-positions";
import type { Database } from "@/lib/supabase/types";
import type { TradeRow } from "./types";

/**
 * A BOOK OUT OF THE LIVE DATABASE, RUN THROUGH THE REAL LIBRARY.
 *
 * Step 10 was meant to be "the application on screen with real data". That part
 * is BLOCKED: this environment's network policy does not allow `*.supabase.co`
 * out of the container (`Host not in allowlist`), so neither the browser nor
 * the Next server can sign in. That is recorded in the report and needs a
 * settings change I cannot make myself.
 *
 * This is the part that WAS possible, and it is not a substitute but a separate
 * value: the rows below are LITERALLY what `tj_position_stats` returned for a
 * book seeded through `tj_save_trade` on the live project — transcribed, not
 * invented. Every `lib` test so far builds its own rows; this one takes them
 * from the database.
 *
 * That closes the SQL → `lib` seam: it proves the numbers SQL produces pass
 * through aggregation untouched, on the same book worked out on paper.
 *
 * THE BOOK (account: USD, starting balance 100,000, breakeven band −5..+5,
 * zone America/New_York):
 *
 *   #1 ES     Long   2 contracts 5000 → 5010, stop 4990, commission 4
 *      gross  (5010−5000)×2×50 = +1000   net +996     R = 20/(10×2) = +1.00
 *   #2 ES     Short  1 contract  5020 → 5030, stop 5030, commission 2
 *      gross  −10×1×50 = −500            net −502     R = −10/(10×1) = −1.00
 *   #3 EURUSD Long   0.5 lots    1.0800 → 1.0830, stop 1.0780, comm 1, swap 0.5
 *      gross  0.0015×100000 = +150       net +148.50  R = 0.0015/0.001 = +1.50
 *   #4 NQ     Long   1 contract  21000 → 21000, stop 20950, commission 2
 *      gross  0                          net −2       R = 0
 *   #5 XYZ    Long   1 contract  100 → 110 — A SYMBOL WITH NO INSTRUMENT
 *      money null, but R = 10/5 = +2.00 (R lives in prices, not in money)
 *   #6 NQ     Long   1 contract  21050, OPEN, time stop 3 days
 *
 *   totals (closed and valued): gross +650, net +640.50
 *   2 wins, 1 loss, 1 breakeven (−2 is INSIDE the band)
 *   win rate 2/(2+1) = 66.67 %, total R +1.50, average R +0.375
 */

type StatsRow = Database["public"]["Views"]["tj_position_stats"]["Row"];

const RAW: {
  id: string;
  trade_no: number;
  instrument: string;
  direction: string;
  status: string;
  stats: Partial<StatsRow> | null;
}[] = [
  {
    id: "ccfd81f9-f2b4-4644-bdcb-d0a82d95e6a8",
    trade_no: 1,
    instrument: "ES",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "ccfd81f9-f2b4-4644-bdcb-d0a82d95e6a8",
      net_pl: 996, gross_pl: 1000, realized_r: 1, realized_r_net: 0.996,
      avg_entry: 5000, avg_exit: 5010, entry_qty: 2, exit_qty: 2,
      total_fees: 4, total_swap: 0,
      opened_at: "2026-03-02T14:30:00+00:00", closed_at: "2026-03-02T16:00:00+00:00",
      duration_seconds: 5400, point_value: 50, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "8323ca02-132f-4b21-9c1e-4a58039aefc1",
    trade_no: 2,
    instrument: "ES",
    direction: "Short",
    status: "closed",
    stats: {
      position_id: "8323ca02-132f-4b21-9c1e-4a58039aefc1",
      net_pl: -502, gross_pl: -500, realized_r: -1, realized_r_net: -1.004,
      avg_entry: 5020, avg_exit: 5030, entry_qty: 1, exit_qty: 1,
      total_fees: 2, total_swap: 0,
      opened_at: "2026-03-03T14:30:00+00:00", closed_at: "2026-03-03T15:00:00+00:00",
      duration_seconds: 1800, point_value: 50, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "af53861c-bc18-4cc4-ad81-38fc14b5b8ca",
    trade_no: 3,
    instrument: "EURUSD",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "af53861c-bc18-4cc4-ad81-38fc14b5b8ca",
      net_pl: 148.5, gross_pl: 150, realized_r: 1.5, realized_r_net: 1.485,
      avg_entry: 1.08, avg_exit: 1.083, entry_qty: 0.5, exit_qty: 0.5,
      total_fees: 1, total_swap: 0.5,
      opened_at: "2026-03-04T13:00:00+00:00", closed_at: "2026-03-04T18:00:00+00:00",
      duration_seconds: 18000, point_value: 100000, tick_size: 0.00001,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "b27fa3dd-7976-40be-8633-bde24d4afa52",
    trade_no: 4,
    instrument: "NQ",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "b27fa3dd-7976-40be-8633-bde24d4afa52",
      net_pl: -2, gross_pl: 0, realized_r: 0, realized_r_net: -0.002,
      avg_entry: 21000, avg_exit: 21000, entry_qty: 1, exit_qty: 1,
      total_fees: 2, total_swap: 0,
      opened_at: "2026-03-05T14:30:00+00:00", closed_at: "2026-03-05T15:30:00+00:00",
      duration_seconds: 3600, point_value: 20, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
  {
    id: "389e730d-fb2a-4c20-b90b-65d94dfc682e",
    trade_no: 5,
    instrument: "XYZ",
    direction: "Long",
    status: "closed",
    stats: {
      position_id: "389e730d-fb2a-4c20-b90b-65d94dfc682e",
      net_pl: null, gross_pl: null, realized_r: 2, realized_r_net: null,
      avg_entry: 100, avg_exit: 110, entry_qty: 1, exit_qty: 1,
      total_fees: 2, total_swap: 0,
      opened_at: "2026-03-06T14:30:00+00:00", closed_at: "2026-03-06T15:30:00+00:00",
      duration_seconds: 3600, point_value: null, tick_size: null,
      point_value_source: "missing", quote_currency: null,
      account_currency: "USD", fx_rate: null, fx_rate_source: "missing",
      money_overridden: false,
    },
  },
  {
    id: "793c67d5-c55a-46b6-9baa-8ff2290b9050",
    trade_no: 6,
    instrument: "NQ",
    direction: "Long",
    status: "open",
    stats: {
      position_id: "793c67d5-c55a-46b6-9baa-8ff2290b9050",
      net_pl: null, gross_pl: null, realized_r: null, realized_r_net: null,
      avg_entry: 21050, avg_exit: null, entry_qty: 1, exit_qty: null,
      total_fees: 1, total_swap: 0,
      opened_at: "2026-03-04T14:30:00+00:00", closed_at: null,
      duration_seconds: null, point_value: 20, tick_size: 0.25,
      point_value_source: "snapshot", quote_currency: "USD",
      account_currency: "USD", fx_rate: 1, fx_rate_source: "snapshot",
      money_overridden: false,
    },
  },
];

/** The same shape `getTradesWithStats` builds, through the same narrowing. */
const TRADES: TradeRow[] = RAW.map(
  (r) =>
    ({
      id: r.id,
      account_id: "9b10b46a-931c-4415-9a0c-b1a01cfdf232",
      trade_no: r.trade_no,
      instrument: r.instrument,
      direction: r.direction,
      status: r.status,
      source: "manual",
      needs_review: false,
      created_at: "2026-08-16T10:30:42.912437+00:00",
      time_stop_days: r.trade_no === 6 ? 3 : null,
      stats: r.stats ? narrowPositionStat(r.stats as StatsRow) : null,
    }) as unknown as TradeRow,
);

const ACCOUNT = {
  breakeven_from: -5,
  breakeven_to: 5,
  breakeven_unit: "currency",
  starting_balance: 100_000,
} as BreakevenConfig;

const RANGE = resolveBreakevenRange(ACCOUNT);
const TZ = "America/New_York";

describe("the SQL → lib seam, on a book from the live database", () => {
  const realized = toRealized(TRADES);
  const stats = computeStats(realized, "net", RANGE);

  it("an unvalued and an open trade do not enter the realized set", () => {
    // Five are closed, but one has no money. Four remain — and that is the gap
    // `unpricedClosedCount` exists to acknowledge.
    expect(realized).toHaveLength(4);
    expect(unpricedClosedCount(TRADES)).toBe(1);
  });

  it("net and gross agree with the paper to the cent", () => {
    expect(stats.netSum).toBeCloseTo(640.5, 10);
    expect(stats.grossSum).toBeCloseTo(650, 10);
    // Cross-check through the costs: 650 − 9 commission − 0.5 swap = 640.50
    expect(stats.grossSum - 9 - 0.5).toBeCloseTo(stats.netSum, 10);
  });

  it("outcomes respect the account's BAND, not the raw sign", () => {
    // −$2 is a loss by sign and a breakeven by the −5..+5 band. Had the band
    // been ignored, the win rate would be 2/3 → 50 % instead of 66.67 %.
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.breakeven).toBe(1);
    expect(stats.winRate).toBeCloseTo((2 / 3) * 100, 8);
  });

  it("R sums over the trades that have one", () => {
    expect(stats.totalR).toBeCloseTo(1.5, 10);
    expect(stats.avgR).toBeCloseTo(0.375, 10);
  });

  it("an UNVALUED trade's R exists although the money does not — and enters no total", () => {
    // For #5 the view returned `realized_r = 2.0` alongside `net_pl = null`: R
    // lives in prices and survives an unknown `point_value`. But `toRealized`
    // discards the row over the money, so that R enters nowhere. A gap, not a
    // bug — and worth having measured, because it is the only R in the book
    // that appears on no screen at all.
    const petica = TRADES.find((t) => t.trade_no === 5)!;
    expect(petica.stats?.realized_r).toBe(2);
    expect(petica.stats?.net_pl).toBeNull();
    expect(realized.some((r) => r.id === petica.id)).toBe(false);
    expect(stats.totalR).toBeCloseTo(1.5, 10);
  });
});

describe("day by day, in the account's zone", () => {
  it("every trade falls on its CLOSE day by the New York clock", () => {
    // 2026-03-02T16:00Z is 11:00 in New York — the same day. Had the day been
    // computed in UTC, #1 would still be the 2nd, but a trade closed at 23:30
    // NY would fly into tomorrow's cell. That is why the account's zone is the
    // only authority.
    const daily = dailyPnl(toRealized(TRADES), "net", () => TZ);
    expect(daily.get("2026-03-02")).toBeCloseTo(996, 10);
    expect(daily.get("2026-03-03")).toBeCloseTo(-502, 10);
    expect(daily.get("2026-03-04")).toBeCloseTo(148.5, 10);
    expect(daily.get("2026-03-05")).toBeCloseTo(-2, 10);
    // The 6th is the unvalued trade's day — it is absent from the map, and
    // that is right: a day with no valued result is not a day with a zero.
    expect(daily.has("2026-03-06")).toBe(false);
  });

  it("the sum of the days is the sum of the book", () => {
    const total = [...dailyPnl(toRealized(TRADES), "net", () => TZ).values()]
      .reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(640.5, 10);
  });
});

describe("otvorena pozicija", () => {
  const only6 = (dayKey: string) =>
    openPositionsOn(TRADES, dayKey, () => TZ).find(
      (p) => p.id === "793c67d5-c55a-46b6-9baa-8ff2290b9050",
    );

  it("THE CLOSE DAY COUNTS AS OPEN — deliberately, and easy to assume otherwise", () => {
    // I wrote this backwards first. Only #2 was opened on 3 March, and it
    // closed the same day — so `openPositionsOn` returns it anyway.
    //
    // That is deliberate: the position was alive that day, it could have been
    // managed, and its thesis was either right or wrong that morning. Leaving
    // it out would make the last day of every trade — often the one that
    // decided the outcome — the one day nobody recorded.
    const treci = openPositionsOn(TRADES, "2026-03-03", () => TZ);
    expect(treci).toHaveLength(1);
    expect(treci[0].id).toBe("8323ca02-132f-4b21-9c1e-4a58039aefc1");
  });

  it("before anything is opened the list is empty", () => {
    expect(openPositionsOn(TRADES, "2026-03-01", () => TZ)).toHaveLength(0);
  });

  it("6 March is the third day held, and the time stop is NOT breached", () => {
    // Opened on the 4th, so the 4th, 5th and 6th are three sessions — 1-based
    // counting. The stop is 3 days; on the day it is reached the plan is still
    // being kept, and the breach belongs to the day it is exceeded.
    const p = only6("2026-03-06")!;
    expect(p.daysInTrade).toBe(3);
    expect(p.timeStopDays).toBe(3);
    expect(p.pastTimeStop).toBe(false);
  });

  it("7 March is the fourth day, and then it IS breached", () => {
    const p = only6("2026-03-07")!;
    expect(p.daysInTrade).toBe(4);
    expect(p.pastTimeStop).toBe(true);
  });
});
