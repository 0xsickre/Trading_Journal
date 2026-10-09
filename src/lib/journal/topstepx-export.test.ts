import { describe, expect, it } from "vitest";
import {
  TOPSTEPX_COLUMNS,
  TOPSTEPX_HEADERS,
  isTopstepXTrades,
  groupTopstepXTrades,
  readTopstepXTrades,
  topstepXImportRows,
  topstepXTime,
} from "./topstepx-export";

/** The first real row, from a TopstepX practice account on 28.09.2026. */
const REAL = {
  Id: "3142050021",
  ContractName: "MNQZ6",
  EnteredAt: "09/28/2026 10:43:54 +02:00",
  ExitedAt: "09/28/2026 10:47:38 +02:00",
  EntryPrice: "30584.000000000",
  ExitPrice: "30600.250000000",
  Fees: "0.72000",
  PnL: "-32.500000000",
  Size: "1",
  Type: "Short",
  TradeDay: "09/28/2026 00:00:00 -05:00",
  TradeDuration: "00:03:44.2166590",
  Commissions: "0.50000",
};

const pointValue = (s: string) => ({ MNQ: 2, NQ: 20, MES: 5, ES: 50 })[s] ?? null;

describe("recognising the export", () => {
  it("is its header, in any order", () => {
    expect(isTopstepXTrades([...TOPSTEPX_HEADERS])).toBe(true);
    expect(isTopstepXTrades([...TOPSTEPX_HEADERS].reverse())).toBe(true);
    expect(isTopstepXTrades(TOPSTEPX_HEADERS.filter((h) => h !== "EnteredAt"))).toBe(false);
  });
});

describe("its clock", () => {
  it("is month-first with the offset the file carries", () => {
    expect(topstepXTime("09/28/2026 10:43:54 +02:00")).toBe("2026-09-28T10:43:54+02:00");
    expect(new Date(topstepXTime("09/28/2026 10:43:54 +02:00")!).toISOString()).toBe("2026-09-28T08:43:54.000Z");
    expect(topstepXTime("12/01/2026 15:30:00 -06:00")).toBe("2026-12-01T15:30:00-06:00");
  });

  it("refuses what it cannot place — no offset, no such month or day", () => {
    expect(topstepXTime("09/28/2026 10:43:54")).toBeNull();
    expect(topstepXTime("28/09/2026 10:43:54 +02:00")).toBeNull(); // day-first is not this layout
    expect(topstepXTime("02/30/2026 10:00:00 +02:00")).toBeNull();
    expect(topstepXTime("2026-09-28 10:43:54 +02:00")).toBeNull();
  });
});

describe("reading a trade", () => {
  it("reads the real row as the trade it was", () => {
    const [t] = readTopstepXTrades([REAL], pointValue);
    expect(t).toMatchObject({
      id: "3142050021",
      contract: "MNQZ6",
      symbol: "MNQ",
      direction: "Short",
      size: 1,
      entryPrice: 30584,
      exitPrice: 30600.25,
      entryTime: "2026-09-28T10:43:54+02:00",
      exitTime: "2026-09-28T10:47:38+02:00",
      pnl: -32.5,
      problem: null,
    });
    // Topstep's round turn on MNQ is 1.22: exchange fees plus its commission.
    expect(t.fees).toBeCloseTo(1.22, 10);
  });

  it("refuses a result the catalog's multiplier cannot produce", () => {
    const [t] = readTopstepXTrades([{ ...REAL, PnL: "-325.0" }], pointValue);
    expect(t.problem).toMatch(/multiplier/);
  });

  it("refuses a side it does not know and a contract outside the catalog", () => {
    expect(readTopstepXTrades([{ ...REAL, Type: "Buy" }], pointValue)[0].problem).toMatch(/Long nor Short/);
    expect(readTopstepXTrades([{ ...REAL, ContractName: "CLX6" }], pointValue)[0].problem).toMatch(/catalog/);
  });

  it("skips the empty line the export ends with", () => {
    expect(readTopstepXTrades([REAL, { Id: "" }], pointValue)).toHaveLength(1);
  });
});

describe("the flat table", () => {
  it("carries the root as the symbol and the contract beside it", () => {
    const [row] = topstepXImportRows(readTopstepXTrades([REAL], pointValue));
    expect(row[TOPSTEPX_COLUMNS.symbol]).toBe("MNQ");
    expect(row[TOPSTEPX_COLUMNS.contract]).toBe("MNQZ6");
    expect(row[TOPSTEPX_COLUMNS.side]).toBe("Short");
    expect(row[TOPSTEPX_COLUMNS.entryTime]).toBe("2026-09-28T10:43:54+02:00");
    expect(Number(row[TOPSTEPX_COLUMNS.fee])).toBeCloseTo(1.22, 10);
    expect(row[TOPSTEPX_COLUMNS.issue]).toBe("");
  });
});

describe("one position, many rows (09.10.2026)", () => {
  // The trader's test on Practice: four entries of 1 MNQ, closed together. TopstepX
  // exports one row per entry lot, all with the same exit.
  const row = (Id: string, EnteredAt: string, EntryPrice: string, PnL: string, Size = "1") => ({
    Id,
    ContractName: "MNQZ6",
    EnteredAt,
    ExitedAt: "10/09/2026 15:18:09 +02:00",
    EntryPrice,
    ExitPrice: "31216.000000000",
    Fees: "0.72000",
    PnL,
    Size,
    Type: "Long",
    TradeDay: "10/09/2026 00:00:00 -05:00",
    TradeDuration: "00:02:20",
    Commissions: "0.50000",
  });
  const rows = [
    { ...row("3185746493", "10/08/2026 21:57:01 +02:00", "30969.75", "52.5", "3"), ExitedAt: "10/08/2026 21:58:21 +02:00", ExitPrice: "30978.5" },
    row("3188092767", "10/09/2026 15:15:49 +02:00", "31206.5", "19"),
    row("3188092768", "10/09/2026 15:16:08 +02:00", "31209.5", "13"),
    row("3188092769", "10/09/2026 15:16:17 +02:00", "31209.25", "13.5"),
    row("3188092770", "10/09/2026 15:17:12 +02:00", "31216.5", "-1"),
  ];

  it("joins the rows of a position that never went flat into one trade", () => {
    const positions = groupTopstepXTrades(readTopstepXTrades(rows, pointValue));
    expect(positions).toHaveLength(2);
    const p = positions[1];
    expect(p.id).toBe("3188092767+3188092768+3188092769+3188092770");
    expect(p.size).toBe(4);
    expect(p.entryTime).toBe("2026-10-09T15:15:49+02:00");
    expect(p.exitTime).toBe("2026-10-09T15:18:09+02:00");
    expect(p.entryPrice).toBeCloseTo(31210.4375, 6);
    expect(p.pnl).toBeCloseTo(44.5, 6);
    expect(p.fees).toBeCloseTo(4.88, 6);
    expect(p.fills?.filter((f) => f.side === "entry").map((f) => f.price)).toEqual([31206.5, 31209.5, 31209.25, 31216.5]);
    // One exit order closed all four: one exit fill, not four.
    expect(p.fills?.filter((f) => f.side === "exit")).toEqual([
      { side: "exit", price: 31216, qty: 4, time: "2026-10-09T15:18:09+02:00", fee: expect.closeTo(4.88, 6) },
    ]);
  });

  it("carries every fill into the flat table", () => {
    const [, r] = topstepXImportRows(groupTopstepXTrades(readTopstepXTrades(rows, pointValue)));
    expect(r[TOPSTEPX_COLUMNS.volume]).toBe("4");
    expect(JSON.parse(r[TOPSTEPX_COLUMNS.fills])).toHaveLength(5);
  });

  it("keeps positions apart once the book went flat between them", () => {
    const flat = [
      row("1", "10/09/2026 15:15:49 +02:00", "31206.5", "19"),
      { ...row("2", "10/09/2026 15:18:09 +02:00", "31209.5", "13"), ExitedAt: "10/09/2026 15:20:00 +02:00" },
    ];
    expect(groupTopstepXTrades(readTopstepXTrades(flat, pointValue))).toHaveLength(2);
  });
});
