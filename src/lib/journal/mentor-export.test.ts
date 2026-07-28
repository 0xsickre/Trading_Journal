import { describe, expect, it } from "vitest";
import { buildMentorPack, resolveCalendarRange } from "./mentor-export";
import { resolveBreakevenRange } from "./breakeven";
import type { PositionStat, TradeRow } from "./types";

function trade(id: string, netPl: number): TradeRow {
  const stats: PositionStat = {
    position_id: id,
    avg_entry: 100,
    avg_exit: 110,
    entry_qty: 1,
    exit_qty: 1,
    gross_pl: netPl,
    net_pl: netPl,
    total_fees: 0,
    total_swap: 0,
    realized_r: netPl / 100,
    realized_r_net: null,
    opened_at: "2026-01-01T10:00:00Z",
    closed_at: "2026-01-02T10:00:00Z",
    duration_seconds: 86_400,
    point_value: 1,
    tick_size: null,
    point_value_source: "snapshot",
  };
  return {
    id,
    account_id: "a",
    trade_no: null,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: "2026-01-01T10:00:00Z",
    instrument: "SP500",
    direction: "Long",
    stats,
    tv_images: {},
  } as TradeRow;
}

/** Pull "Win rate | 66.7% (2W / 1L / 0BE)" out of the generated markdown. */
function winRateLine(md: string): string {
  const line = md.split("\n").find((l) => l.startsWith("| Win rate |"));
  if (!line) throw new Error("no win rate row in mentor pack");
  return line;
}

describe("buildMentorPack breakeven band", () => {
  // A small fee-only loser: the account calls -12.40 breakeven, exact-zero does not.
  const trades = [trade("w", 500), trade("be", -12.4), trade("l", -400)];

  it("classifies with exact zero when no band is supplied", () => {
    const md = buildMentorPack(trades, { currency: "USD" });
    expect(winRateLine(md)).toContain("1W / 2L / 0BE");
  });

  it("honours the account's configured band", () => {
    // The band the dashboard would resolve for this account.
    const range = resolveBreakevenRange({
      breakeven_from: -37.5,
      breakeven_to: 0,
      breakeven_unit: "currency",
      starting_balance: 100_000,
    });

    const md = buildMentorPack(trades, {
      currency: "USD",
      breakevenRange: range,
    });

    // The same trades, now graded the way the dashboard grades them: the
    // fee-only trade is a scratch, not a loss, and win rate rises accordingly.
    expect(winRateLine(md)).toContain("1W / 1L / 1BE");
    expect(winRateLine(md)).toContain("50.0%");
  });

  it("still reports every trade's money regardless of the band", () => {
    const md = buildMentorPack(trades, {
      currency: "USD",
      breakevenRange: resolveBreakevenRange({
        breakeven_from: -37.5,
        breakeven_to: 0,
        breakeven_unit: "currency",
        starting_balance: 100_000,
      }),
    });
    // 500 - 12.40 - 400 = 87.60 — the scratch still costs what it cost.
    expect(md).toContain("| Net P/L | +87.60 USD |");
  });
});

describe("resolveCalendarRange", () => {
  it("returns the calendar quarter containing the anchor", () => {
    const r = resolveCalendarRange("quarter", "2026-08-15");
    expect(r.fromISO).toBe("2026-07-01T00:00:00.000Z");
    expect(r.toISO).toBe("2026-09-30T23:59:59.999Z");
  });

  it("returns the Monday-based week containing the anchor", () => {
    // 2026-07-28 is a Tuesday.
    const r = resolveCalendarRange("week", "2026-07-28");
    expect(r.rangeText).toBe("2026-07-27 → 2026-08-02");
  });

  it("orders a reversed custom range", () => {
    const r = resolveCalendarRange("custom", "", "2026-03-10", "2026-03-01");
    expect(r.rangeText).toBe("2026-03-01 → 2026-03-10");
  });
});
