import { describe, expect, it } from "vitest";
import { buildPositionPatch } from "./trade-fields";
import { computeStatus } from "./trade-lifecycle";
import { computePositionStats } from "./position-stats";
import { toRealized } from "./analytics";
import { enrichTrades } from "./enriched-trade";
import { resolveBreakevenRange } from "./breakeven";
import { runReport } from "./reports/engine";
import { rawFieldDimension } from "./reports/dimensions";
import { getMetric } from "./reports/metrics";
import { excursionFromTrade } from "./excursion";
import type { PositionStat, TradeRow } from "./types";
import type { Account } from "./types";

/**
 * ONE TRADE, ALL THE WAY THROUGH.
 *
 * Every other test in this suite checks a module against its own contract. That
 * catches a module that is wrong and misses a pair of modules that are each
 * right and disagree — which is where the defects in this codebase have actually
 * come from: the form and the server using two different fill predicates, the
 * grid and the picker keeping two lists of columns, the SQL view and its TS twin
 * drifting apart.
 *
 * This test walks a single trade from the shape the FORM produces to the number
 * a REPORT prints, through:
 *
 *   form values → buildPositionPatch → computeStatus → computePositionStats
 *               → toRealized → enrichTrades → runReport
 *
 * and asserts the same three facts at every stage they are visible. If any two
 * layers stop agreeing about what this trade is worth, one of these fails.
 *
 * It runs offline, with no database and no browser — deliberately. A browser
 * end-to-end suite would additionally cover the routes and the components, and
 * cannot run in this container: there are no Supabase credentials and no server
 * to point it at. That is a separate decision, recorded in the review rather
 * than half-built here.
 */

const ACCOUNT = {
  id: "acc1",
  name: "Main",
  starting_balance: 10_000,
  timezone: "America/New_York",
  breakeven_from: -20,
  breakeven_to: 20,
  breakeven_unit: "currency",
} as unknown as Account;

describe("one trade, from form values to a report row", () => {
  // ---- 1. What the form hands over --------------------------------------
  const formValues = {
    instrument: "XAUUSD",
    direction: "Long",
    entry_price: "2400",
    stop_price: "2390",
    target_price: "2430",
    risk_pct: "1",
    exit_reason: "TP hit",
    technical_tags: ["FVG", "Liquidity Sweep"],
    max_drawdown_price: "2395",
    max_profit_price: "2425",
    trade_journal_notes: "  sweep into FVG  ",
  };

  const patch = buildPositionPatch(formValues);

  it("coerces the form's strings into numbers exactly once", () => {
    // The form works in strings because inputs do. Everything downstream does
    // arithmetic, so the boundary is here and nowhere else — a second coercion
    // later is how "2400" and 2400 end up in the same column.
    expect(patch.columns.entry_price).toBe(2400);
    expect(patch.columns.stop_price).toBe(2390);
    expect(patch.columns.technical_tags).toEqual(["FVG", "Liquidity Sweep"]);
    // Trimmed. This assertion used to read `"  sweep into FVG  "` and carried a
    // note saying the untrimmed value was a FINDING rather than a behaviour to
    // rely on — `customFieldDimensions` registers every user-defined text field
    // as a groupable dimension, so a stray space splits "A" and " A" into two
    // report buckets that look identical on screen. Step 6 closed it in
    // `buildPositionPatch`, which is the save path the note pointed at, and the
    // assertion flipped with the fix.
    expect(patch.columns.trade_journal_notes).toBe("sweep into FVG");
  });

  // ---- 2. Fills arrive, status follows from them -------------------------
  const fills = [
    { side: "entry" as const, price: 2401, qty: 2, executed_at: "2026-03-02T14:30:00Z", fee: 3, swap_funding: 0 },
    { side: "exit" as const, price: 2421, qty: 2, executed_at: "2026-03-02T19:45:00Z", fee: 3, swap_funding: 0 },
  ];

  it("closes the position because the fills say so, not because a field does", () => {
    expect(computeStatus(fills, "planned")).toBe("closed");
  });

  // ---- 3. The row as the database would hold it --------------------------
  const stats = computePositionStats({
    direction: "Long",
    entry_price: 2400,
    stop_price: 2390,
    point_value: 1,
    fx_rate: 1,
    executions: fills,
  });

  const row: TradeRow = {
    id: "t1",
    account_id: ACCOUNT.id,
    trade_no: 1,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: "2026-03-02T14:00:00Z",
    ...patch.columns,
    stats: {
      position_id: "t1",
      avg_entry: stats.avg_entry,
      avg_exit: stats.avg_exit,
      entry_qty: stats.entry_qty,
      exit_qty: stats.exit_qty,
      gross_pl: stats.gross_pl,
      net_pl: stats.net_pl,
      total_fees: stats.total_fees,
      total_swap: stats.total_swap,
      realized_r: stats.realized_r,
      realized_r_net: stats.realized_r_net,
      opened_at: fills[0].executed_at,
      closed_at: fills[1].executed_at,
      duration_seconds: 18_900,
      point_value: 1,
      fx_rate: 1,
      tick_size: 0.01,
      point_value_source: "snapshot",
    } as PositionStat,
  };

  it("prices the trade off the fills and the plan, each where it belongs", () => {
    // 2 lots, 2401 → 2421 = 40 points gross, minus 6 in fees.
    expect(stats.gross_pl).toBeCloseTo(40, 10);
    expect(stats.net_pl).toBeCloseTo(34, 10);
    // 1R is the PLANNED distance, 2400 → 2390 = 10 points, over 2 lots = 20.
    expect(stats.planned_risk_pts).toBe(10);
    expect(stats.realized_r).toBeCloseTo(2, 10);
  });

  // ---- 4. Enrichment: outcome, day, excursion ----------------------------
  const range = resolveBreakevenRange(ACCOUNT);
  const realized = toRealized([row]);
  const [enriched] = enrichTrades(realized, {
    tzOf: () => ACCOUNT.timezone,
    range,
  });

  it("agrees on the day, in the account's zone and dated by close", () => {
    // Opened 09:30 and closed 14:45 New York time — same day here, but the
    // point is that both come from the ACCOUNT's zone, not the runner's.
    expect(enriched.openDay).toBe("2026-03-02");
    expect(enriched.closeDay).toBe("2026-03-02");
    expect(enriched.closeWeek).toBe("2026-03-02");
  });

  it("calls it a win, and the breakeven band does not swallow it", () => {
    // Net 34 sits outside the account's ±20 band. Inside it, the same trade
    // would be `breakeven` — which is why the band is read from the account
    // rather than assumed to be zero.
    expect(enriched.outcome).toBe("win");
    expect(enriched.pnl).toBeCloseTo(34, 10);
  });

  it("carries the excursion the form typed, converted to R", () => {
    // MAE 2395 against a 2401 average fill = 6 points offside, over a 10-point
    // planned R.
    const ex = excursionFromTrade(row);
    expect(ex.maeR).toBeCloseTo(0.6, 10);
    // MFE 2425 = 24 points onside = 2.4R; realized 2R, so 83% captured.
    expect(ex.mfeR).toBeCloseTo(2.4, 10);
    expect(ex.capturePct).toBeCloseTo((2 / 2.4) * 100, 8);
    // The guarantee from `excursion-scan`: you cannot keep more than was there.
    expect(ex.capturePct!).toBeLessThanOrEqual(100);
  });

  // ---- 5. The report the trader actually reads ---------------------------
  const report = runReport({
    trades: [enriched],
    dimension: rawFieldDimension("exit_reason"),
    metricKeys: ["net_pnl", "trade_count", "win_rate", "avg_r", "expectancy"],
    dimensionContext: { reportByDate: new Map() },
    metricContext: { pnlBasis: "net", range },
    minSample: 1,
  });

  it("reports the same numbers the stats layer computed", () => {
    // The end of the chain. If a metric ever stops reading through
    // `computeStats`, or the enrichment stops carrying `pnl`, this diverges
    // from the assertions above and the two halves of the app disagree.
    expect(report).not.toBeNull();
    // Grouped on `exit_reason` rather than `setup_grade`: the grade is no
    // longer a form value at all, it is derived from the playbook criteria, so
    // it can no longer stand for "a field the form hands over end to end".
    const grade = report!.rows.find((r) => r.bucket === "TP hit");
    expect(grade).toBeDefined();
    expect(grade!.n).toBe(1);
    expect(grade!.values.net_pnl).toBeCloseTo(34, 10);
    expect(grade!.values.trade_count).toBe(1);
    expect(grade!.values.win_rate).toBe(100);
    expect(grade!.values.avg_r).toBeCloseTo(2, 10);
  });

  it("flags the single-trade bucket as below sample, at the default threshold", () => {
    // The guard `?min=abc` used to switch off. One trade is a bucket, never a
    // finding, and the report has to say so.
    const guarded = runReport({
      trades: [enriched],
      dimension: rawFieldDimension("exit_reason"),
      metricKeys: ["net_pnl"],
      dimensionContext: { reportByDate: new Map() },
      metricContext: { pnlBasis: "net", range },
      minSample: 5,
    });
    expect(guarded!.rows[0].belowSample).toBe(true);
  });

  it("keeps every metric it was asked for resolvable in the registry", () => {
    // A report column naming a metric the registry does not know renders blank
    // with no error anywhere.
    for (const key of ["net_pnl", "trade_count", "win_rate", "avg_r", "expectancy"]) {
      expect(getMetric(key), key).toBeDefined();
    }
  });
});
