import type { PositionStatsInput } from "./position-stats";

/**
 * TWENTY TRADE SHAPES, WORKED OUT ON PAPER, FOR BOTH ENGINES THAT COMPUTE MONEY.
 *
 * `position-stats.ts` opens with the sentence "must stay in sync with
 * `tj_position_stats` SQL view". Until this file that was only a sentence: the
 * TS side had tests, the SQL side none, and no test compared the two. The money
 * the application shows comes from SQL; the TS twin is used for the preview in
 * the form before saving. No `lib/` test could see a defect in the view.
 *
 * So what stands here are the EXPECTED values worked out on paper, not the
 * output of either engine. The fixture is the standard; both engines are
 * measured against it:
 *
 *   - `position-stats.parity.test.ts` runs `computePositionStats` through every
 *     one of these cases on each `vitest run`;
 *   - the same book was also run through `tj_position_stats` against the live
 *     database: 12 base shapes × 9 columns = 108 assertions, plus 5 FX shapes ×
 *     7 columns = 35, 143 in total — all passing. The procedure and the result
 *     are in `CODE_REVIEW.md`.
 *
 * While both sides aim at the same numbers off the paper, they cannot drift
 * apart without at least one of them failing. Snapshot tests lock in current
 * behaviour including its bugs; this one locks in the ANSWER.
 *
 * The numbers are chosen so that every one of them checks out in your head.
 */

export type ParityCase = {
  name: string;
  /** What this shape proves — why it is in the set. */
  proves: string;
  input: PositionStatsInput;
  paper: {
    avg_entry: number | null;
    avg_exit: number | null;
    gross_points: number | null;
    gross_pl: number | null;
    net_pl: number | null;
    planned_risk_pts: number | null;
    realized_r: number | null;
    realized_r_net: number | null;
  };
};

export const PARITY_CASES: ParityCase[] = [
  {
    name: "T1 long, one fill",
    proves: "the base case: dir_mult = +1, gross_points = exit − entry",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 5030, qty: 1 },
      ],
    },
    // risk = |5000 − 4990| = 10 ; gross = (5030 − 5000) × 1 = 30 ; R = 30 / (10 × 1)
    paper: {
      avg_entry: 5000,
      avg_exit: 5030,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 30,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 3,
    },
  },
  {
    name: "T2 short",
    proves: "dir_mult = −1: a falling price is a win",
    input: {
      direction: "Short",
      entry_price: 5000,
      stop_price: 5010,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 4970, qty: 1 },
      ],
    },
    // gross = (4970 − 5000) × (−1) = +30 ; risk = |5000 − 5010| = 10
    paper: {
      avg_entry: 5000,
      avg_exit: 4970,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 30,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 3,
    },
  },
  {
    name: "T3 scale-in, two entry fills",
    proves: "avg_entry is quantity-weighted, not a mean of prices",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 5000, qty: 2 },
        { side: "entry", price: 5010, qty: 2 },
        { side: "exit", price: 5045, qty: 4 },
      ],
    },
    // entry: (10000 + 10020) / 4 = 5005 ; gross = 20180 − 5005×4 = 160
    // risk runs from the PLANNED entry 5000, not from 5005 → 10 ; R = 160 / (10 × 4) = 4
    paper: {
      avg_entry: 5005,
      avg_exit: 5045,
      gross_points: 160,
      gross_pl: 160,
      net_pl: 160,
      planned_risk_pts: 10,
      realized_r: 4,
      realized_r_net: 4,
    },
  },
  {
    name: "T4 partial exit, 4 of 10",
    proves:
      "R is measured against the risk TAKEN, not against the closed part — the " +
      "closed part ran a full 1.0 R, and the trade reports 0.4 R because the " +
      "remaining 6 units still stand under the same risk",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 100, qty: 10 },
        { side: "exit", price: 110, qty: 4 },
      ],
    },
    // gross covers only the 4 that closed: (440 − 100×4) = 40
    // the denominator covers all 10: 10 × 10 = 100 → R = 0.4
    paper: {
      avg_entry: 100,
      avg_exit: 110,
      gross_points: 40,
      gross_pl: 40,
      net_pl: 40,
      planned_risk_pts: 10,
      realized_r: 0.4,
      realized_r_net: 0.4,
    },
  },
  {
    name: "T5 commissions and swap",
    proves: "net = gross − commissions − swap ; realized_r stays on the GROSS basis",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1, fee: 2, swap_funding: 3 },
        { side: "exit", price: 5030, qty: 1, fee: 2 },
      ],
    },
    // gross 30 ; costs 4 + 3 = 7 ; net 23
    // R = 30/10 = 3.0 (gross) ; R_net = 23/10 = 2.3 — two different bases, on purpose
    paper: {
      avg_entry: 5000,
      avg_exit: 5030,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 23,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 2.3,
    },
  },
  {
    name: "T6 with no point_value",
    proves:
      "money is null and R survives: R is a ratio in PRICE space and needs no " +
      "contract spec. This is where `COALESCE(point_value, 1)` fell — see " +
      "20260728120000_snapshot_instrument_spec.sql",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: null,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 100, qty: 1 },
        { side: "exit", price: 130, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 100,
      avg_exit: 130,
      gross_points: 30,
      gross_pl: null,
      net_pl: null,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: null,
    },
  },
  {
    name: "T7 stop equal to entry",
    proves:
      "zero risk gives an UNDEFINED R, not an infinite one — `NULLIF(..., 0)` in " +
      "the view, `risk > 0 ? risk : null` in TS",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 5000,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 5030, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 5000,
      avg_exit: 5030,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 30,
      planned_risk_pts: null,
      realized_r: null,
      realized_r_net: null,
    },
  },
  {
    name: "T8 open position",
    proves: "with no exit there is no realized result — null, not zero",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      fx_rate: 1,
      executions: [{ side: "entry", price: 5000, qty: 1 }],
    },
    paper: {
      avg_entry: 5000,
      avg_exit: null,
      gross_points: null,
      gross_pl: null,
      net_pl: null,
      planned_risk_pts: 10,
      realized_r: null,
      realized_r_net: null,
    },
  },
  {
    name: "T9 breakeven",
    proves: "an exit at the entry price gives exact zero, and that is data rather than an absence",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 5000, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 5000,
      avg_exit: 5000,
      gross_points: 0,
      gross_pl: 0,
      net_pl: 0,
      planned_risk_pts: 10,
      realized_r: 0,
      realized_r_net: 0,
    },
  },
  {
    name: "T10 two exit fills",
    proves: "avg_exit is quantity-weighted too",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 100, qty: 4 },
        { side: "exit", price: 110, qty: 2 },
        { side: "exit", price: 120, qty: 2 },
      ],
    },
    // exit: (220 + 240) / 4 = 115 ; gross = 460 − 400 = 60 ; R = 60 / (10 × 4) = 1.5
    paper: {
      avg_entry: 100,
      avg_exit: 115,
      gross_points: 60,
      gross_pl: 60,
      net_pl: 60,
      planned_risk_pts: 10,
      realized_r: 1.5,
      realized_r_net: 1.5,
    },
  },
  {
    name: "T11 forex point_value",
    proves:
      "points × 100,000: a small price move is real money. This is the difference " +
      "between $1000 and $0.01 if the contract spec fails",
    input: {
      direction: "Long",
      entry_price: 1.1,
      stop_price: 1.095,
      point_value: 100_000,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 1.1, qty: 1 },
        { side: "exit", price: 1.11, qty: 1 },
      ],
    },
    // gross = 0.01 points ; × 100,000 = $1000 ; risk = 0.005 → R = 2
    paper: {
      avg_entry: 1.1,
      avg_exit: 1.11,
      gross_points: 0.01,
      gross_pl: 1000,
      net_pl: 1000,
      planned_risk_pts: 0.005,
      realized_r: 2,
      realized_r_net: 2,
    },
  },
  {
    name: "T12 with no planned entry price",
    proves:
      "risk falls back to the AVERAGE FILL when there is no plan — `COALESCE(entry_price, avg_entry)`",
    input: {
      direction: "Long",
      entry_price: null,
      stop_price: 90,
      point_value: 1,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 100, qty: 1 },
        { side: "exit", price: 110, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 100,
      avg_exit: 110,
      gross_points: 10,
      gross_pl: 10,
      net_pl: 10,
      planned_risk_pts: 10,
      realized_r: 1,
      realized_r_net: 1,
    },
  },

  // ---------------------------------------------------------------------------
  // FX — until 20260815130000 money was in the QUOTE currency and was summed as if it were not.
  // ---------------------------------------------------------------------------
  {
    name: "FX1 USDJPY, rate recorded",
    proves:
      "gross arises in YEN and has to go through the rate. Without conversion this " +
      "trade reported 100,000 and printed it with a `$` — 149 times too much",
    input: {
      direction: "Long",
      entry_price: 150.0,
      stop_price: 149.0,
      point_value: 100_000,
      fx_rate: 0.0067,
      executions: [
        { side: "entry", price: 150.0, qty: 1 },
        { side: "exit", price: 151.0, qty: 1 },
      ],
    },
    // gross = 1.00 points × 100,000 = 100,000 JPY ; × 0.0067 = 670 USD
    // risk = 1.00 → R = 1.00 / (1.00 × 1) = 1 ; R_net = 670 / (1 × 1 × 100000 × 0.0067)
    paper: {
      avg_entry: 150.0,
      avg_exit: 151.0,
      gross_points: 1,
      gross_pl: 670,
      net_pl: 670,
      planned_risk_pts: 1,
      realized_r: 1,
      realized_r_net: 1,
    },
  },
  {
    name: "FX2 USDCAD, the commission is NOT converted",
    proves:
      "the order: gross × rate − costs. The commission is already in the account's " +
      "currency because that is how brokers book it, so the other order would " +
      "charge $5 at a rate of 0.73",
    input: {
      direction: "Long",
      entry_price: 1.35,
      stop_price: 1.345,
      point_value: 100_000,
      fx_rate: 0.73,
      executions: [
        { side: "entry", price: 1.35, qty: 1, fee: 5 },
        { side: "exit", price: 1.36, qty: 1 },
      ],
    },
    // gross = 0.01 × 100,000 = 1000 CAD ; × 0.73 = 730 USD ; − 5 = 725
    // risk = 0.005 → R = 0.01 / 0.005 = 2 ; R_net = 725 / (0.005 × 100000 × 0.73) = 725/365
    paper: {
      avg_entry: 1.35,
      avg_exit: 1.36,
      gross_points: 0.01,
      gross_pl: 730,
      net_pl: 725,
      planned_risk_pts: 0.005,
      realized_r: 2,
      realized_r_net: 725 / 365,
    },
  },
  {
    name: "FX3 rate unknown",
    proves:
      "an unknown rate nulls the MONEY, not the trade. The same policy as for " +
      "point_value: a rate of 1 as a fallback would quietly equate a yen with a " +
      "dollar",
    input: {
      direction: "Long",
      entry_price: 150.0,
      stop_price: 149.0,
      point_value: 100_000,
      fx_rate: null,
      executions: [
        { side: "entry", price: 150.0, qty: 1 },
        { side: "exit", price: 151.0, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 150.0,
      avg_exit: 151.0,
      gross_points: 1,
      gross_pl: null,
      net_pl: null,
      planned_risk_pts: 1,
      realized_r: 1,
      realized_r_net: null,
    },
  },
  {
    name: "FX4 same currency, rate 1",
    proves: "a USD instrument on a USD account passes untouched — the conversion is a no-op",
    input: {
      direction: "Long",
      entry_price: 1.1,
      stop_price: 1.095,
      point_value: 100_000,
      fx_rate: 1,
      executions: [
        { side: "entry", price: 1.1, qty: 1 },
        { side: "exit", price: 1.11, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 1.1,
      avg_exit: 1.11,
      gross_points: 0.01,
      gross_pl: 1000,
      net_pl: 1000,
      planned_risk_pts: 0.005,
      realized_r: 2,
      realized_r_net: 2,
    },
  },
  {
    name: "FX5 rate and point_value both unknown",
    proves:
      "two independent reasons for the same outcome must not cancel out — R still " +
      "stands, because it is a ratio in price space and needs neither",
    input: {
      direction: "Long",
      entry_price: 1.1,
      stop_price: 1.095,
      point_value: null,
      fx_rate: null,
      executions: [
        { side: "entry", price: 1.1, qty: 1 },
        { side: "exit", price: 1.11, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 1.1,
      avg_exit: 1.11,
      gross_points: 0.01,
      gross_pl: null,
      net_pl: null,
      planned_risk_pts: 0.005,
      realized_r: 2,
      realized_r_net: null,
    },
  },

  // ---------------------------------------------------------------------------
  // OVERRIDE — a result entered directly, instead of derived from prices.
  // ---------------------------------------------------------------------------
  {
    name: "OV1 an override bypasses prices and rate",
    proves:
      "an entered result beats a computed one. Prices still give gross_points and " +
      "R, but the money comes off the broker's statement where it is already " +
      "converted",
    input: {
      direction: "Long",
      entry_price: 150.0,
      stop_price: 149.0,
      point_value: 100_000,
      // The rate is NOT known — and that no longer stops the money.
      fx_rate: null,
      gross_pnl_override: 642.18,
      executions: [
        { side: "entry", price: 150.0, qty: 1 },
        { side: "exit", price: 151.0, qty: 1 },
      ],
    },
    // Computed it would be 100,000 JPY × an unknown rate = null. Entered: 642.18.
    paper: {
      avg_entry: 150.0,
      avg_exit: 151.0,
      gross_points: 1,
      gross_pl: 642.18,
      net_pl: 642.18,
      planned_risk_pts: 1,
      realized_r: 1,
      // R IN MONEY still needs a denominator from prices × rate, so it stays null.
      realized_r_net: null,
    },
  },
  {
    name: "OV2 an override still pays the costs",
    proves:
      "net = override − commissions − swap. An override is GROSS, not net — the " +
      "broker's statement keeps them as separate columns and that is how they " +
      "are entered",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      fx_rate: 1,
      gross_pnl_override: 250,
      executions: [
        { side: "entry", price: 100, qty: 1, fee: 7, swap_funding: 3 },
        { side: "exit", price: 130, qty: 1 },
      ],
    },
    // Computed it would be 30. Entered 250 → net 250 − 7 − 3 = 240.
    // R stays 30/10 = 3.0 because it is measured FROM PRICES, not from entered money.
    paper: {
      avg_entry: 100,
      avg_exit: 130,
      gross_points: 30,
      gross_pl: 250,
      net_pl: 240,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 24,
    },
  },
  {
    name: "OV3 an override can be a loss",
    proves: "a negative entry passes; a zero would be breakeven rather than an absence",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      fx_rate: 1,
      gross_pnl_override: -125.5,
      executions: [
        { side: "entry", price: 100, qty: 1 },
        { side: "exit", price: 95, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 100,
      avg_exit: 95,
      gross_points: -5,
      gross_pl: -125.5,
      net_pl: -125.5,
      planned_risk_pts: 10,
      realized_r: -0.5,
      realized_r_net: -12.55,
    },
  },
];
