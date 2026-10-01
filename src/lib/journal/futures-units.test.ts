import { describe, expect, it } from "vitest";
import type { RealizedTrade } from "./analytics";
import { familiesOf, instrumentFamily, toUnits, unitFactor } from "./futures-units";
import type { PositionStat, TradeRow } from "./types";

const trade = (instrument: string, net: number, pv: number | null, tick: number | null, fees = 0): RealizedTrade => ({
  id: `${instrument}-${net}`,
  closedAt: "2026-10-01T15:00:00Z",
  net,
  gross: net + fees,
  r: null,
  row: {
    id: "t",
    account_id: "a",
    trade_no: 1,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: "2026-10-01T14:00:00Z",
    instrument,
    stats: { point_value: pv, tick_size: tick, fx_rate: 1, total_fees: fees } as PositionStat,
  } as TradeRow,
});

describe("instrumentFamily", () => {
  it("counts a micro with its mini and reads contract months", () => {
    expect(instrumentFamily("MNQ")).toBe("NQ");
    expect(instrumentFamily("MNQZ6")).toBe("NQ");
    expect(instrumentFamily("NQ")).toBe("NQ");
    expect(instrumentFamily("MES")).toBe("ES");
    expect(instrumentFamily("M6E")).toBe("6E");
    expect(instrumentFamily("XAUUSD")).toBe("XAUUSD");
    expect(instrumentFamily(null)).toBeNull();
  });

  it("lists the families present", () => {
    expect(familiesOf([trade("MNQ", 1, 2, 0.25), trade("ES", 1, 50, 0.25), trade("NQ", 1, 20, 0.25)])).toEqual(["NQ", "ES"]);
  });
});

describe("unitFactor", () => {
  it("inverts the money: point value × FX, and the tick for ticks", () => {
    expect(unitFactor({ point_value: 20, tick_size: 0.25, fx_rate: 1 }, "points")).toBe(1 / 20);
    expect(unitFactor({ point_value: 20, tick_size: 0.25, fx_rate: 1 }, "ticks")).toBe(1 / 5);
    expect(unitFactor({ point_value: 20, tick_size: null, fx_rate: 1 }, "ticks")).toBeNull();
    expect(unitFactor({ point_value: null, tick_size: 0.25 }, "points")).toBeNull();
    expect(unitFactor(null, "points")).toBeNull();
  });
});

describe("toUnits (U1: points count every contract)", () => {
  it("two MNQ over ten points are twenty points; one NQ over ten is ten", () => {
    // 2 MNQ × 10 points = $40; 1 NQ × 10 points = $200; fees $2.44 on the MNQ.
    const u = toUnits([trade("MNQ", 40, 2, 0.25, 2.44), trade("NQZ6", 200, 20, 0.25)], "points")!;
    expect(u.map((t) => t.net)).toEqual([20, 10]);
    expect(u[0].gross).toBeCloseTo(21.22, 9);
    expect(u[0].row.stats?.total_fees).toBeCloseTo(1.22, 9);
    expect(toUnits([trade("MNQ", 40, 2, 0.25)], "ticks")![0].net).toBe(80);
  });

  it("refuses a mix of families, a trade it cannot convert, and nothing", () => {
    expect(toUnits([trade("MNQ", 40, 2, 0.25), trade("MES", 50, 5, 0.25)], "points")).toBeNull();
    expect(toUnits([trade("MNQ", 40, 2, null)], "ticks")).toBeNull();
    expect(toUnits([trade("MNQ", 40, null, 0.25)], "points")).toBeNull();
    expect(toUnits([], "points")).toBeNull();
  });
});
