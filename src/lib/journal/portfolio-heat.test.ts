import { describe, expect, it } from "vitest";
import {
  heatByAccount,
  heatExceedsPerTradeLimit,
  heatForAccount,
  openRiskMoney,
} from "./portfolio-heat";
import type { TradeRow } from "./types";

/**
 * The three ways this number could lie, each pinned: a half-closed position
 * carrying its opening risk, an unpriced position counted as safe, and two
 * accounts' percentages added together.
 */

type Spec = {
  id: string;
  account?: string;
  entry?: number;
  stop?: number | null;
  entryQty?: number;
  exitQty?: number;
  pointValue?: number;
  fxRate?: number;
};

function row(s: Spec): TradeRow {
  return {
    id: s.id,
    account_id: s.account ?? "acc-1",
    trade_no: null,
    instrument: "XAUUSD",
    status: "open",
    entry_price: s.entry ?? 100,
    stop_price: s.stop === undefined ? 90 : s.stop,
    stats: {
      position_id: s.id,
      avg_entry: s.entry ?? 100,
      entry_qty: s.entryQty ?? 1,
      exit_qty: s.exitQty ?? 0,
      point_value: s.pointValue ?? 1,
      fx_rate: s.fxRate ?? 1,
      net_pl: null,
      gross_pl: null,
      opened_at: "2026-03-02T09:00:00Z",
      closed_at: null,
    },
  } as unknown as TradeRow;
}

describe("openRiskMoney — what is still at stake, not what was", () => {
  it("prices the whole position while nothing has been taken off", () => {
    // 10 points of stop × 2 lots × point value 1 = 20.
    expect(openRiskMoney(row({ id: "a", entryQty: 2 }))).toBe(20);
  });

  it("halves with the position — a half-closed trade does not carry full risk", () => {
    expect(openRiskMoney(row({ id: "a", entryQty: 2, exitQty: 1 }))).toBe(10);
  });

  it("is zero once nothing is open, and null when it cannot be priced", () => {
    expect(openRiskMoney(row({ id: "a", entryQty: 2, exitQty: 2 }))).toBe(0);
    expect(openRiskMoney(row({ id: "b", stop: null }))).toBeNull();
    expect(openRiskMoney(row({ id: "c", entryQty: 0 }))).toBeNull();
  });

  it("carries the instrument's own scale and its FX rate", () => {
    // Gold: 10 points × 100 per point × 0.5 lots = 500, converted at 0.9.
    expect(
      openRiskMoney(row({ id: "g", entryQty: 0.5, pointValue: 100, fxRate: 0.9 })),
    ).toBeCloseTo(450, 10);
  });
});

describe("heatForAccount", () => {
  it("adds the measured positions and states the denominator it used", () => {
    const heat = heatForAccount(
      "acc-1",
      [row({ id: "a", entryQty: 2 }), row({ id: "b", entryQty: 1 })],
      1000,
    );
    expect(heat.totalRiskMoney).toBe(30);
    expect(heat.totalRiskPct).toBe(3);
    expect(heat.priced).toBe(2);
    expect(heat.unpriced).toBe(0);
  });

  it("counts an unpriced position rather than adding it as zero", () => {
    const heat = heatForAccount(
      "acc-1",
      [row({ id: "a", entryQty: 2 }), row({ id: "nostop", stop: null })],
      1000,
    );
    // The 20 that can be measured, and a position that says it cannot be.
    expect(heat.totalRiskMoney).toBe(20);
    expect(heat.priced).toBe(1);
    expect(heat.unpriced).toBe(1);
    expect(heat.positions.find((p) => p.id === "nostop")!.riskPct).toBeNull();
  });

  it("carries a position with no instrument recorded rather than dropping it", () => {
    const noSymbol = { ...row({ id: "a" }), instrument: null } as unknown as TradeRow;
    const heat = heatForAccount("acc-1", [noSymbol], 1000);
    expect(heat.positions[0].instrument).toBeNull();
    expect(heat.totalRiskMoney).toBe(10);
  });

  it("labels a position by its trade number, falling back to the id", () => {
    const numbered = { ...row({ id: "abcdef1234" }), trade_no: 42 } as unknown as TradeRow;
    const heat = heatForAccount("acc-1", [numbered, row({ id: "abcdef1234" })], 1000);
    expect(heat.positions.map((p) => p.label)).toEqual(["#42", "abcdef12"]);
  });

  it("has no percentage without an equity to divide by", () => {
    const heat = heatForAccount("acc-1", [row({ id: "a" })], null);
    expect(heat.totalRiskMoney).toBe(10);
    expect(heat.totalRiskPct).toBeNull();
  });

  it("is null, not zero, when every position is unpriced", () => {
    const heat = heatForAccount("acc-1", [row({ id: "a", stop: null })], 1000);
    expect(heat.totalRiskPct).toBeNull();
    expect(heat.priced).toBe(0);
  });
});

describe("heatByAccount — percentages of different denominators are never added", () => {
  it("answers one heat per account, each over its own equity", () => {
    const equity: Record<string, number> = { small: 5000, big: 100_000 };
    const heats = heatByAccount(
      [
        row({ id: "s", account: "small", entryQty: 10 }), // 100 = 2 % of 5,000
        row({ id: "b", account: "big", entryQty: 200 }), // 2,000 = 2 % of 100,000
      ],
      (id) => equity[id] ?? null,
    );
    expect(heats).toHaveLength(2);
    expect(heats.map((h) => h.totalRiskPct)).toEqual([2, 2]);
    // And no total anywhere: 2 % + 2 % is not 4 % of anything that exists.
    expect(heats.every((h) => h.accountId in equity)).toBe(true);
  });

  it("leaves out accounts with nothing open", () => {
    expect(heatByAccount([], () => 1000)).toEqual([]);
  });

  it("skips a row with no account at all rather than inventing one", () => {
    const orphan = { ...row({ id: "x" }), account_id: null } as unknown as TradeRow;
    expect(heatByAccount([orphan], () => 1000)).toEqual([]);
  });
});

describe("heatExceedsPerTradeLimit", () => {
  const heat = (pct: number | null) =>
    ({ totalRiskPct: pct }) as ReturnType<typeof heatForAccount>;

  it("compares the open total against the ceiling one trade is allowed", () => {
    expect(heatExceedsPerTradeLimit(heat(2.4), 1)).toBe(true);
    expect(heatExceedsPerTradeLimit(heat(0.8), 1)).toBe(false);
  });

  it("says nothing rather than 'within limits' when there is no limit or no figure", () => {
    expect(heatExceedsPerTradeLimit(heat(2.4), null)).toBeNull();
    expect(heatExceedsPerTradeLimit(heat(2.4), 0)).toBeNull();
    expect(heatExceedsPerTradeLimit(heat(null), 1)).toBeNull();
  });
});
