import { describe, expect, it } from "vitest";
import { isMt5Statement, mt5ImportRows, readMt5Statement } from "./mt5-statement";
import { parseImportTime } from "./time";

/**
 * The grid is the OWNER'S OWN REPORT, cell for cell.
 *
 * `ReportHistory-1514682848.xlsx`, exported from the FTMO demo on 20 Sep 2026,
 * read the way the wizard reads a sheet (`sheet_to_json`, `header: 1`). The
 * account had no trades yet, so the banners, the header rows and the account
 * line are real and the POSITION ROWS are written here in MT5's shape — the
 * one thing in this file that a filled report still has to confirm.
 */
const REPORT: unknown[][] = [
  ["Trade History Report"],
  ["Name:", "", "", "€160k FTMO Free Trial 2-Step"],
  ["Account:", "", "", "1514682848 (EUR, FTMO-Demo, demo, Hedge)"],
  ["Company:", "", "", "FTMO Global Markets Ltd"],
  ["Date:", "", "", "2026.09.20 00:16"],
  ["Positions"],
  ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P",
    "Time", "Price", "Commission", "Swap", "Profit"],
  ["Orders"],
  ["Open Time", "Order", "Symbol", "Type", "Volume", "Price", "S / L", "T / P",
    "Time", "State", "", "Comment"],
  ["Deals"],
  ["Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price", "Order",
    "Commission", "Fee", "Swap", "Profit", "Balance", "Comment"],
  ["2026.09.19 10:26:22", "523194092", "", "balance", "", "", "", "", "0", "0",
    "0", "160000.0", "160000.0", "Initial account balance"],
  ["", "", "", "", "", "", "", "", "0.0", "0.0", "0.0", "160000.0", "160000.0"],
  ["Balance:", "", "", "160000.0", "", "", "Free Margin:", "", "", "160000.0"],
  ["Results"],
  ["Total Net Profit:", "", "", "0.0", "Gross Profit:", "", "", "0.0"],
];

/** The same report with positions under the banner, as a traded account has. */
function withPositions(...rows: unknown[][]): unknown[][] {
  const out = [...REPORT];
  out.splice(7, 0, ...rows);
  return out;
}

const LONG = [
  "2026.09.21 09:15:03", "524100011", "XAUUSD", "buy", "0.50", "3712.45",
  "3698.00", "3745.10", "2026.09.21 14:02:41", "3740.80", "-3.50", "-0.75", "1417.50",
];
const SHORT = [
  "2026.09.22 15:30:00", "524100012", "NAS100", "sell", "1.00", "24 512.30",
  "24 610.00", "24 300.00", "2026.09.22 17:44:12", "24 588.10", "-2.00", "0.00", "-757,80",
];

describe("recognising an MT5 report", () => {
  it("accepts the owner's own export", () => {
    expect(isMt5Statement(REPORT)).toBe(true);
  });

  it("rejects a plain table, which the generic mapping already handles", () => {
    expect(isMt5Statement([["Symbol", "Side", "Qty"], ["XAUUSD", "Long", "1"]])).toBe(false);
  });

  it("rejects an empty sheet", () => {
    expect(isMt5Statement([])).toBe(false);
  });
});

describe("the account line", () => {
  it("gives the currency the figures are in, and the account number", () => {
    const out = readMt5Statement(REPORT)!;
    expect(out.currency).toBe("EUR");
    expect(out.account).toBe("1514682848");
  });
});

describe("the Positions table", () => {
  it("an untraded account reads as no positions, not as a failure", () => {
    expect(readMt5Statement(REPORT)!.positions).toEqual([]);
  });

  it("reads a closed long", () => {
    const out = readMt5Statement(withPositions(LONG))!;
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]).toEqual({
      id: "524100011",
      symbol: "XAUUSD",
      direction: "Long",
      volume: 0.5,
      entryPrice: 3712.45,
      entryTime: "2026.09.21 09:15:03",
      exitPrice: 3740.8,
      exitTime: "2026.09.21 14:02:41",
      target: 3745.1,
      commission: -3.5,
      swap: -0.75,
      profit: 1417.5,
      problem: null,
    });
  });

  it("reads a short, with the separators MT5 writes on a European locale", () => {
    const [short] = readMt5Statement(withPositions(SHORT))!.positions;
    expect(short.direction).toBe("Short");
    expect(short.entryPrice).toBe(24512.3);
    expect(short.profit).toBe(-757.8);
  });

  it("the entry is the FIRST Time and Price, the exit the second", () => {
    // The header names both pairs the same. Keyed by name, the close would
    // overwrite the open and every trade would import at its exit price.
    const [t] = readMt5Statement(withPositions(LONG))!.positions;
    expect(t.entryPrice).toBe(3712.45);
    expect(t.exitPrice).toBe(3740.8);
  });

  it("times are what the wizard's parser reads, in the account's zone", () => {
    const [t] = readMt5Statement(withPositions(LONG))!.positions;
    expect(parseImportTime(t.entryTime, "Europe/Prague")).toBe("2026-09-21T07:15:03.000Z");
  });

  it("stops at the next banner — Orders and Deals are not positions", () => {
    const out = readMt5Statement(withPositions(LONG, SHORT))!;
    expect(out.positions.map((p) => p.id)).toEqual(["524100011", "524100012"]);
  });

  it("skips the totals row under the table, which has no ticket", () => {
    const totals = ["", "", "", "", "", "", "", "", "", "", "-5.50", "-0.75", "659.70"];
    expect(readMt5Statement(withPositions(LONG, totals))!.positions).toHaveLength(1);
  });

  it("names a row it cannot read instead of importing a guess", () => {
    const broken = [...LONG];
    broken[3] = "balance";
    broken[5] = "";
    const [t] = readMt5Statement(withPositions(broken))!.positions;
    expect(t.problem).toContain("type");
    expect(t.problem).toContain("entry price");
  });

  it("costs change sign: MT5 writes what it took, the journal counts cost", () => {
    // net_pl is gross - fees - swap. MT5's -3.50 commission imported as -3.50
    // would ADD 3.50 to the result of every trade.
    const [row] = mt5ImportRows(readMt5Statement(withPositions(LONG))!);
    expect(row.Commission).toBe("3.5");
    expect(row.Swap).toBe("0.75");
    expect(row.Profit).toBe("1417.5");
  });

  it("a credit stays a credit", () => {
    const credited = [...LONG];
    credited[11] = "0.40";
    const [row] = mt5ImportRows(readMt5Statement(withPositions(credited))!);
    expect(row.Swap).toBe("-0.4");
  });

  it("the flat row carries the ticket, the side and the problem", () => {
    const [row] = mt5ImportRows(readMt5Statement(withPositions(SHORT))!);
    expect(row).toMatchObject({
      Ticket: "524100012",
      Symbol: "NAS100",
      Side: "Short",
      Volume: "1",
      "Entry price": "24512.3",
      "Exit time": "2026.09.22 17:44:12",
      "T/P": "24300",
      Issue: "",
    });
  });

  it("an unwritten exit stays empty, not zero", () => {
    const open = [...LONG];
    open[8] = "";
    open[9] = "";
    open[12] = "";
    const [row] = mt5ImportRows(readMt5Statement(withPositions(open))!);
    expect(row["Exit price"]).toBe("");
    expect(row.Profit).toBe("");
  });

  it("a position still open keeps its entry and has no exit", () => {
    const open = [...LONG];
    open[8] = "";
    open[9] = "";
    open[12] = "";
    const [t] = readMt5Statement(withPositions(open))!.positions;
    expect(t.exitPrice).toBeNull();
    expect(t.exitTime).toBeNull();
    expect(t.profit).toBeNull();
    expect(t.problem).toBeNull();
  });
});
