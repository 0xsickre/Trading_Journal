import { describe, expect, it } from "vitest";
import { parseImportNumber } from "./import-number";
import { parseImportTime } from "./time";

/**
 * REAL STATEMENTS, NOT INVENTED ONES.
 *
 * `import-number.test.ts` and `time.test.ts` each cover their own function by
 * the rules. This file does something different: it takes the SHAPE of a cell
 * as particular platforms actually write it and runs it down the same path the
 * import takes, because Step 7 asked for checks "against real broker
 * statements".
 *
 * The difference is not cosmetic. A rule is tested on an example that
 * illustrates it; a statement brings combinations nobody would invent — MT5 on
 * a Serbian locale writes `2 345,67` with a space as the thousands separator,
 * cTrader writes ISO with a `Z`, TradeZella exports `$1,234.56` with the
 * currency symbol inside the cell, and Interactive Brokers writes a negative
 * commission as `-2.15` and a date as `2026-03-02, 14:00:00`.
 *
 * Where a format is NOT readable, the test asserts `null`. That is not a hole
 * but this import's policy: a cell that cannot be read honestly shows up on
 * screen as a row that will not go in, rather than being guessed.
 */

const TZ = "Europe/Belgrade";

describe("numbers as the platforms write them", () => {
  const cases: [string, string, number | null][] = [
    // MetaTrader 5, exported on an English locale
    ["MT5 / en", "1234.56", 1234.56],
    ["MT5 / en, thousands", "1 234.56", 1234.56],
    // MetaTrader 5, Serbian / German locale — the reason `import-number.ts`
    // exists at all: earlier code read this as 234567.
    ["MT5 / sr", "2345,67", 2345.67],
    ["MT5 / sr, thousands", "1.234,56", 1234.56],
    ["MT5 / sr, space", "1 234,56", 1234.56],
    ["MT5 / sr, NBSP", "1 234,56", 1234.56],
    // TradeZella / TraderSync CSV — the currency symbol stays in the cell
    ["TradeZella", "$1,234.56", 1234.56],
    ["TradeZella, loss", "-$250.00", -250],
    ["TradeZella, zero", "$0.00", 0],
    // Interactive Brokers — a negative commission, and the accounting minus
    ["IBKR commission", "-2.15", -2.15],
    ["IBKR parentheses", "(1,234.56)", -1234.56],
    // cTrader — quantity in units, with no separator
    ["cTrader units", "100000", 100000],
    // A lot with three decimals
    ["micro lot", "0.010", 0.01],
    // A futures price in 1/32 notation is NOT read as a number
    ["ZB 32nds notation", "110'16", null],
  ];

  for (const [name, cell, want] of cases) {
    it(`${name}: "${cell}" → ${want}`, () => {
      expect(parseImportNumber(cell)).toBe(want);
    });
  }

  it("`1,234` stays refused on a real statement too", () => {
    // 1234 to an American broker, 1.234 to a German one. Nothing in the cell
    // decides, and both readings are plausible magnitudes for a price, a
    // commission and a quantity alike. This is the only cell in the whole set
    // that is refused although it looks perfectly healthy, so it is worth
    // having the reason written down.
    expect(parseImportNumber("1,234")).toBeNull();
    // With four digits after the comma it is no longer ambiguous — it is decimal.
    expect(parseImportNumber("1,2345")).toBe(1.2345);
  });
});

describe("times as the platforms write them", () => {
  it("MT5: 2026.03.02 14:00:00 in the account time zone", () => {
    // MT5 writes a dot as the date separator and the time in the server's zone.
    // The import reads it as wall-clock time in the ACCOUNT's zone, because
    // that is the zone the trader looks at their day in.
    expect(parseImportTime("2026.03.02 14:00:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("cTrader / API: an ISO stamp with Z is an absolute instant", () => {
    expect(parseImportTime("2026-03-02T14:00:00Z", TZ)).toBe(
      "2026-03-02T14:00:00.000Z",
    );
  });

  it("an ISO stamp with an offset is not shifted twice", () => {
    expect(parseImportTime("2026-03-02T14:00:00+01:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("Interactive Brokers: 2026-03-02, 14:00:00", () => {
    // A comma between date and time. None of the regular expressions match it,
    // so it falls through to the month-name branch — which reads it correctly.
    expect(parseImportTime("2026-03-02, 14:00:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("a bare date reads as midnight in the account's zone", () => {
    expect(parseImportTime("2026-03-02", TZ)).toBe("2026-03-01T23:00:00.000Z");
  });

  it("daylight saving time is respected", () => {
    // 2026-07-01 is UTC+2 in Belgrade, 2026-03-02 is UTC+1. A fixed offset
    // would miss by an hour here — and an hour moves a trade into another day
    // when it sits near midnight, and so into another calendar cell.
    expect(parseImportTime("2026-07-01 14:00:00", TZ)).toBe(
      "2026-07-01T12:00:00.000Z",
    );
  });

  it("dd/mm/yyyy is REFUSED, and that is policy rather than an oversight", () => {
    // 02/03/2026 is 2 March to half the world and 3 February to the other
    // half. Nothing in the cell decides. A refused row is visible on screen; a
    // guessed row would quietly land a month away, in the wrong report month.
    expect(parseImportTime("02/03/2026", TZ)).toBeNull();
    expect(parseImportTime("02/03/2026 14:00", TZ)).toBeNull();
    expect(parseImportTime("02-03-2026", TZ)).toBeNull();
    // An offset does not resolve it either — it fixes the hour, never the field order.
    expect(parseImportTime("02/03/2026 14:00:00+01:00", TZ)).toBeNull();
  });

  it("a month name is unambiguous and therefore passes", () => {
    expect(parseImportTime("2 Mar 2026 14:00:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("an empty or unrecognisable cell gives null, not now", () => {
    // `?? new Date()` used to close this branch and was the worst line in the
    // import: a trade from three months ago got the MOMENT OF IMPORT and landed
    // in today's P&L.
    expect(parseImportTime("", TZ)).toBeNull();
    expect(parseImportTime("   ", TZ)).toBeNull();
    expect(parseImportTime("n/a", TZ)).toBeNull();
    expect(parseImportTime(null, TZ)).toBeNull();
  });
});
