import { describe, expect, it } from "vitest";
import {
  excelSerialToWallClock,
  groupTradingViewPositions,
  isTradingViewTrades,
  readTradingViewExport,
  resolveTradingViewScale,
  symbolFromTradingViewFilename,
  tradingViewExcursion,
  tradingViewPnlMismatch,
} from "./tradingview-export";

// The header row of a real Bar Replay export (OANDA:XCUUSD, 18 Sep 2026).
const HEADERS = [
  "Trade number", "Type", "Date and time", "Signal", "Price USD", "Size (qty)",
  "Size (value)", "Net PnL USD", "Return %", "Commission USD",
  "Favorable excursion USD", "Favorable excursion %", "Adverse excursion USD",
  "Adverse excursion %", "Cumulative PnL USD", "Cumulative PnL %", "Duration (bars)",
];

/** Excel serial for a wall-clock time, the way the export stores its dates. */
function serial(y: number, mo: number, d: number, h: number, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) / 86_400_000 + 25569;
}

type Row = Record<string, unknown>;

function row(over: Row): Row {
  const base: Row = Object.fromEntries(HEADERS.map((h) => [h, ""]));
  return { ...base, ...over };
}

// That export's one trade, exit row first — the order TradingView writes them in.
const REAL: Row[] = [
  row({
    "Trade number": 1, Type: "Exit long", "Date and time": serial(2023, 9, 20, 15),
    Signal: "Bracket Stop Loss", "Price USD": 3.71195, "Size (qty)": 53610,
    "Net PnL USD": -2994.8, "Commission USD": 1994.98,
    "Favorable excursion USD": 0, "Adverse excursion USD": -1999.81,
  }),
  row({
    "Trade number": 1, Type: "Entry long", "Date and time": serial(2023, 9, 20, 14),
    Signal: "Buy limit order", "Price USD": 3.7306, "Size (qty)": 53610,
    "Net PnL USD": -2994.8, "Commission USD": 1994.98,
    "Favorable excursion USD": 0, "Adverse excursion USD": -1999.81,
  }),
];

describe("recognising the export", () => {
  it("accepts TradingView's list of trades", () => {
    expect(isTradingViewTrades(HEADERS)).toBe(true);
  });

  it("rejects a broker statement", () => {
    expect(isTradingViewTrades(["Symbol", "Type", "Volume", "Open Price", "Profit"])).toBe(false);
  });

  it("rejects money in two currencies — the arithmetic would mix them", () => {
    const mixed = HEADERS.map((h) => (h === "Commission USD" ? "Commission EUR" : h));
    expect(isTradingViewTrades(mixed)).toBe(false);
  });
});

describe("the symbol lives only in the file name", () => {
  it("reads EXCHANGE_SYMBOL before the date", () => {
    expect(symbolFromTradingViewFilename("Replay_Trading_OANDA_XCUUSD_2026-09-18_f1e45.xlsx")).toBe("XCUUSD");
  });

  it("keeps a continuous-futures suffix", () => {
    expect(symbolFromTradingViewFilename("My_Strategy_COMEX_HG1!_2026-01-02_ab12c.xlsx")).toBe("HG1!");
  });

  it("refuses a renamed file instead of guessing", () => {
    expect(symbolFromTradingViewFilename("copper trades.xlsx")).toBeNull();
  });
});

describe("Excel serials are wall clocks, not instants", () => {
  it("reads the clock the cell shows", () => {
    expect(excelSerialToWallClock(serial(2023, 9, 20, 14))).toBe("2023-09-20 14:00:00");
  });

  it("absorbs floating-point noise in the serial", () => {
    expect(excelSerialToWallClock(45189.583333333336)).toBe("2023-09-20 14:00:00");
  });

  it("refuses a number that is not a plausible date", () => {
    expect(excelSerialToWallClock(3.7306)).toBeNull();
    expect(excelSerialToWallClock(Number.NaN)).toBeNull();
  });
});

describe("pairing entry and exit rows", () => {
  it("joins the two rows of one trade into one", () => {
    const out = readTradingViewExport(REAL)!;
    expect(out.currency).toBe("USD");
    expect(out.trades).toHaveLength(1);
    expect(out.trades[0]).toMatchObject({
      number: "1",
      direction: "Long",
      size: 53610,
      entryPrice: 3.7306,
      entryTime: "2023-09-20 14:00:00",
      exitPrice: 3.71195,
      exitTime: "2023-09-20 15:00:00",
      commission: 1994.98,
      netPnl: -2994.8,
      adverse: -1999.81,
      problem: null,
    });
  });

  it("reads a short from the Type column", () => {
    const shorts = REAL.map((r) => ({ ...r, Type: String(r.Type).replace("long", "short") }));
    expect(readTradingViewExport(shorts)!.trades[0].direction).toBe("Short");
  });

  it("an exit signalled Open is a mark at the last bar, not a fill", () => {
    const open = [{ ...REAL[0], Signal: "Open" }, REAL[1]];
    const t = readTradingViewExport(open)!.trades[0];
    expect(t.exitPrice).toBeNull();
    expect(t.exitTime).toBeNull();
    expect(t.problem).toBeNull();
  });

  it("names a trade that does not pair, instead of dropping it", () => {
    const twoEntries = [...REAL, REAL[1]];
    expect(readTradingViewExport(twoEntries)!.trades[0].problem).toContain("2 entry rows");
  });

  it("names sides that disagree", () => {
    const bad = [{ ...REAL[0], Type: "Exit short" }, REAL[1]];
    expect(readTradingViewExport(bad)!.trades[0].problem).toContain("disagree on side");
  });

  it("reads the same layout from CSV text", () => {
    const text = REAL.map((r) => ({
      ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])),
      "Date and time": r.Type === "Entry long" ? "2023-09-20 14:00" : "2023-09-20 15:00",
    }));
    const t = readTradingViewExport(text)!.trades[0];
    expect(t.size).toBe(53610);
    expect(t.entryTime).toBe("2023-09-20 14:00");
    expect(t.problem).toBeNull();
  });
});

describe("TradingView's size against the catalog's lots", () => {
  const trades = readTradingViewExport(REAL)!.trades;

  it("a CFD counted in units divides by the point value — 53,610 lb is 536.1 lots of 100", () => {
    expect(resolveTradingViewScale(trades, 100)).toEqual({ ok: true, unit: "units", divisor: 100 });
  });

  it("futures counted in contracts stay as they are", () => {
    // 2 HG contracts, 0.01 move: TradingView's money is 2 × 0.01 × 25,000.
    const hg = readTradingViewExport([
      row({ "Trade number": 1, Type: "Entry long", "Date and time": serial(2024, 1, 2, 10),
        Signal: "Long", "Price USD": 4, "Size (qty)": 2, "Net PnL USD": 500, "Commission USD": 0 }),
      row({ "Trade number": 1, Type: "Exit long", "Date and time": serial(2024, 1, 2, 12),
        Signal: "TP", "Price USD": 4.01, "Size (qty)": 2, "Net PnL USD": 500, "Commission USD": 0 }),
    ])!.trades;
    expect(resolveTradingViewScale(hg, 25_000)).toEqual({ ok: true, unit: "contracts", divisor: 1 });
  });

  it("refuses when the instrument is not in the catalog", () => {
    expect(resolveTradingViewScale(trades, null).ok).toBe(false);
  });

  it("refuses a scale that is neither — a quote currency that is not the P&L's", () => {
    const fx = readTradingViewExport([
      row({ "Trade number": 1, Type: "Entry long", "Date and time": serial(2024, 1, 2, 10),
        Signal: "Long", "Price USD": 18000, "Size (qty)": 1, "Net PnL USD": 108, "Commission USD": 0 }),
      row({ "Trade number": 1, Type: "Exit long", "Date and time": serial(2024, 1, 2, 12),
        Signal: "TP", "Price USD": 18100, "Size (qty)": 1, "Net PnL USD": 108, "Commission USD": 0 }),
    ])!.trades;
    // NAS100 priced in USD, the strategy's money in EUR at 1.08: 108 per point.
    const scale = resolveTradingViewScale(fx, 1);
    expect(scale.ok).toBe(false);
    if (!scale.ok) expect(scale.error).toContain("1.08");
  });

  it("refuses when no closed trade moved — there is nothing to read the scale from", () => {
    const open = readTradingViewExport([{ ...REAL[0], Signal: "Open" }, REAL[1]])!.trades;
    expect(resolveTradingViewScale(open, 100).ok).toBe(false);
  });
});

describe("every trade is held to the scale", () => {
  const trades = readTradingViewExport(REAL)!.trades;
  const scale = { ok: true, unit: "units", divisor: 100 } as const;

  it("the real trade agrees with its own P&L", () => {
    expect(tradingViewPnlMismatch(trades[0], scale, 100)).toBeNull();
  });

  it("a trade whose P&L does not follow from its prices is named", () => {
    const off = { ...trades[0], netPnl: -5000 };
    expect(tradingViewPnlMismatch(off, scale, 100)).toMatch(/^P&L .* ≠ size × move/);
  });
});

describe("partial exits are one position, not several", () => {
  // Gold, long 165 oz (1.65 lots) at 1313.05, closed 50 oz at 1321.38 and 115 oz
  // at 1351.12. TradingView exports that as trades #1 and #2, each with its own
  // entry row at the same time and price.
  const leg = (n: number, size: number, exit: number, exitHour: number, signal = "Long"): Row[] => {
    const gross = (exit - 1313.05) * size;
    return [
      row({ "Trade number": n, Type: "Exit long", "Date and time": serial(2023, 2, 9, exitHour),
        Signal: "TP", "Price USD": exit, "Size (qty)": size, "Net PnL USD": gross, "Commission USD": 0 }),
      row({ "Trade number": n, Type: "Entry long", "Date and time": serial(2023, 2, 9, 9),
        Signal: signal, "Price USD": 1313.05, "Size (qty)": size, "Net PnL USD": gross, "Commission USD": 0 }),
    ];
  };

  it("joins trades cut from one entry into one position with an exit each", () => {
    const trades = readTradingViewExport([...leg(1, 50, 1321.38, 11), ...leg(2, 115, 1351.12, 15)])!.trades;
    const [pos, ...rest] = groupTradingViewPositions(trades);
    expect(rest).toHaveLength(0);
    expect(pos).toMatchObject({
      numbers: ["1", "2"],
      direction: "Long",
      entryPrice: 1313.05,
      entryTime: "2023-02-09 09:00:00",
      size: 165,
      problem: null,
    });
    expect(pos.exits.map((e) => [e.number, e.price, e.size])).toEqual([
      ["1", 1321.38, 50],
      ["2", 1351.12, 115],
    ]);
  });

  it("orders exits by time, not by trade number", () => {
    const trades = readTradingViewExport([...leg(1, 50, 1351.12, 15), ...leg(2, 115, 1321.38, 11)])!.trades;
    expect(groupTradingViewPositions(trades)[0].exits.map((e) => e.number)).toEqual(["2", "1"]);
  });

  it("keeps entries from different orders apart, even at the same time and price", () => {
    const trades = readTradingViewExport([...leg(1, 50, 1321.38, 11), ...leg(2, 115, 1351.12, 15, "Long 2")])!.trades;
    expect(groupTradingViewPositions(trades)).toHaveLength(2);
  });

  it("never joins a trade with a problem, so the problem stays on its own row", () => {
    const trades = readTradingViewExport([...leg(1, 50, 1321.38, 11), ...leg(2, 115, 1351.12, 15)])!.trades;
    trades[1] = { ...trades[1], problem: "exit price" };
    const positions = groupTradingViewPositions(trades);
    expect(positions).toHaveLength(2);
    expect(positions[1].problem).toBe("exit price");
  });

  it("a leg still open adds its size to the entry and its commission to the entry fee", () => {
    const open: Row[] = leg(2, 115, 1351.12, 15).map((r) => ({ ...r, "Commission USD": 3 }));
    open[0] = { ...open[0], Signal: "Open" };
    const trades = readTradingViewExport([...leg(1, 50, 1321.38, 11), ...open])!.trades;
    const [pos] = groupTradingViewPositions(trades);
    expect(pos.size).toBe(165);
    expect(pos.exits).toHaveLength(1);
    expect(pos.openCommission).toBe(3);
  });
});

describe("MAE/MFE prices from TradingView's own excursions", () => {
  /** Rows of a real export, as CSV reads them: every cell a string. */
  const csv = (lines: string[]) =>
    lines.map((l) => Object.fromEntries(HEADERS.map((h, i) => [h, l.split(",")[i]])));
  const legsOf = (lines: string[]) => readTradingViewExport(csv(lines))!.trades;

  // OANDA:XAUUSD, 18 Sep 2026: two longs, each stopped out. The MFE of both
  // was typed by hand from this file as 1336.836 and 1329.146.
  const GOLD = legsOf([
    "1,Exit long,2018-02-27 05:00,Bracket Stop Loss,1326.629,173,230502.259,-997.74,-0.43,2.3,769.22,0.33,-1405.74,-0.61,-997.74,-1.00,5",
    "1,Entry long,2018-02-26 09:00,Buy limit order,1332.383,173,230502.259,-997.74,-0.43,2.3,769.22,0.33,-1405.74,-0.61,-997.74,-1.00,5",
    "2,Exit long,2018-03-08 17:00,Bracket Stop Loss,1317.616,100,132745,-984.72,-0.74,1.32,168.94,0.13,-1052.26,-0.79,-1982.46,-1.98,8",
    "2,Entry long,2018-03-07 09:00,Buy limit order,1327.45,100,132745,-984.72,-0.74,1.32,168.94,0.13,-1052.26,-0.79,-1982.46,-1.98,8",
  ]);

  it("recovers the MFE typed by hand, to the cent", () => {
    expect(tradingViewExcursion([GOLD[0]], 1)?.mfe).toBe(1336.836);
    expect(tradingViewExcursion([GOLD[1]], 1)?.mfe).toBe(1329.146);
  });

  it("holds the MAE of a trade stopped at a loss to the stop — TradingView's bar reaches past it", () => {
    // Unbounded, the adverse excursion puts the low at 1324.264: the rest of
    // the 4-hour bar the stop was hit in, after the position was closed.
    expect(tradingViewExcursion([GOLD[0]], 1)).toEqual({ mae: 1326.629, mfe: 1336.836 });
    expect(tradingViewExcursion([GOLD[1]], 1)).toEqual({ mae: 1317.616, mfe: 1329.146 });
  });

  it("does not hold the MAE to a stop at breakeven or better — it was moved there", () => {
    const moved = { ...GOLD[0], exitPrice: 1333, netPnl: 100 };
    expect(tradingViewExcursion([moved], 1)?.mae).toBe(1324.264);
  });

  it("a position closed in two parts takes the furthest excursion of its legs, and a take profit bounds the MFE", () => {
    // OANDA:XAUUSD: 50 closed at 1321.377, the other 115 at the target 1351.12.
    const legs = legsOf([
      "1,Exit long,2018-02-12 01:00,Close position (partial),1321.377,50,65652.5,415.69,0.63,0.66,682.02,1.04,-92.48,-0.14,414.94,0.41,4",
      "1,Entry long,2018-02-09 09:00,Buy limit order,1313.05,50,65652.5,415.69,0.63,0.66,682.02,1.04,-92.48,-0.14,414.94,0.41,4",
      "2,Exit long,2018-02-14 13:00,Bracket Take Profit,1351.12,115,151000.75,4376.52,2.90,1.53,4377.3,2.90,-212.7,-0.14,4792.21,4.79,19",
      "2,Entry long,2018-02-09 09:00,Buy limit order,1313.05,115,151000.75,4376.52,2.90,1.53,4377.3,2.90,-212.7,-0.14,4792.21,4.79,19",
    ]);
    expect(tradingViewExcursion(legs, 1)).toEqual({ mae: 1311.207, mfe: 1351.12 });
  });

  it("mirrors for a short: the MAE is above the entry, the MFE below", () => {
    // OANDA:XAUUSD, 19 Sep 2026: a short to its target.
    const [short] = legsOf([
      "1,Exit short,2026-09-14 11:00,Bracket Take Profit,4282.625,15,67154.655,2914.62,4.34,0.66,2914.94,4.34,-509.63,-0.76,2914.62,2.91,42",
      "1,Entry short,2026-09-03 11:00,Sell limit order,4476.977,15,67154.655,2914.62,4.34,0.66,2914.94,4.34,-509.63,-0.76,2914.62,2.91,42",
    ]);
    expect(tradingViewExcursion([short], 1)).toEqual({ mae: 4510.93, mfe: 4282.625 });
  });

  it("a trade that never went its way has its MFE at the entry", () => {
    // The copper trade: favorable 0, stopped out.
    const [copper] = readTradingViewExport(REAL)!.trades;
    expect(tradingViewExcursion([copper], 1)).toEqual({ mae: 3.71195, mfe: 3.7306 });
  });

  it("counts contracts at the point value", () => {
    const contracts = { ...GOLD[0], size: 1.73, favorable: 769.22, commission: 2.3 };
    // 1.73 contracts × 100 per 1.00 is the same money per 1.00 as 173 units.
    expect(tradingViewExcursion([contracts], 100)?.mfe).toBe(1336.836);
  });

  it("answers nothing for a leg still open, a leg with a problem, or no excursion columns", () => {
    expect(tradingViewExcursion([{ ...GOLD[0], exitPrice: null, exitTime: null }], 1)).toBeNull();
    expect(tradingViewExcursion([{ ...GOLD[0], problem: "size" }], 1)).toBeNull();
    expect(tradingViewExcursion([{ ...GOLD[0], favorable: null }], 1)).toBeNull();
    expect(tradingViewExcursion([], 1)).toBeNull();
  });
});
