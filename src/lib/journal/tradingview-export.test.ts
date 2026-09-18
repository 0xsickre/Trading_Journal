import { describe, expect, it } from "vitest";
import {
  excelSerialToWallClock,
  isTradingViewTrades,
  readTradingViewExport,
  resolveTradingViewScale,
  symbolFromTradingViewFilename,
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
