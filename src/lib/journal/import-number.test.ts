import { describe, expect, it } from "vitest";
import { parseImportNumber } from "./import-number";

/**
 * The old parser was one line — strip everything but digits, dot and minus —
 * and it turned `2345,67` into `234567`. Prices, quantities and fees all go
 * through here, so these cases are money.
 */

describe("plain numbers", () => {
  it("reads what needs no interpretation", () => {
    expect(parseImportNumber("1234")).toBe(1234);
    expect(parseImportNumber("1234.56")).toBe(1234.56);
    expect(parseImportNumber("0")).toBe(0);
    expect(parseImportNumber("0.35")).toBe(0.35);
    expect(parseImportNumber(".5")).toBe(0.5);
    expect(parseImportNumber("-12.5")).toBe(-12.5);
    expect(parseImportNumber("+12.5")).toBe(12.5);
  });

  it("answers null for nothing at all", () => {
    expect(parseImportNumber(null)).toBeNull();
    expect(parseImportNumber(undefined)).toBeNull();
    expect(parseImportNumber("")).toBeNull();
    expect(parseImportNumber("   ")).toBeNull();
    expect(parseImportNumber("n/a")).toBeNull();
    expect(parseImportNumber("-")).toBeNull();
  });
});

describe("the separator the cell actually decides", () => {
  it("takes the LAST of a dot and a comma as the decimal point", () => {
    expect(parseImportNumber("1,234.56")).toBe(1234.56); // US
    expect(parseImportNumber("1.234,56")).toBe(1234.56); // EU
    expect(parseImportNumber("1.234.567,89")).toBe(1234567.89);
    expect(parseImportNumber("1,234,567.89")).toBe(1234567.89);
  });

  it("reads a lone comma as a decimal point when the tail is not 3 digits", () => {
    // The case that made this module necessary: a gold fill off an MT5 export.
    expect(parseImportNumber("2345,67")).toBe(2345.67);
    expect(parseImportNumber("0,35")).toBe(0.35);
    expect(parseImportNumber("12,5")).toBe(12.5);
    expect(parseImportNumber("1,23456")).toBe(1.23456);
  });

  it("reads several commas as grouping — no number has two decimal points", () => {
    expect(parseImportNumber("1,234,567")).toBe(1234567);
  });

  it("reads several dots as grouping for the same reason", () => {
    expect(parseImportNumber("1.234.567")).toBe(1234567);
  });
});

describe("what it refuses rather than guess", () => {
  it("REFUSES a lone comma with a three-digit tail", () => {
    // `1,234` is 1234 to a US broker and 1.234 to a German one, and the cell
    // carries nothing that decides which. Both are plausible prices, so a guess
    // is wrong a thousandfold half the time. A refused cell shows up in the
    // wizard as a row that will not import — a question, not a wrong answer.
    expect(parseImportNumber("1,234")).toBeNull();
    expect(parseImportNumber("12,345")).toBeNull();
  });

  it("refuses separators that group into nothing valid", () => {
    expect(parseImportNumber("1.23.456")).toBeNull();
    expect(parseImportNumber("12,34,567")).toBeNull();
    expect(parseImportNumber("1234,56,78")).toBeNull();
  });

  it("refuses a sign buried in the digits", () => {
    expect(parseImportNumber("1-2")).toBeNull();
    expect(parseImportNumber("12+34")).toBeNull();
    expect(parseImportNumber("-12-")).toBeNull();
  });

  it("refuses a cell with no digit in it", () => {
    expect(parseImportNumber(".")).toBeNull();
    expect(parseImportNumber(",")).toBeNull();
    expect(parseImportNumber("USD")).toBeNull();
  });
});

describe("the noise a statement wraps a number in", () => {
  it("drops currency symbols and stray letters", () => {
    expect(parseImportNumber("$1,234.56")).toBe(1234.56);
    expect(parseImportNumber("1234.56 USD")).toBe(1234.56);
    expect(parseImportNumber("€ 2345,67")).toBe(2345.67);
  });

  it("takes a space or a non-breaking space as the group separator", () => {
    expect(parseImportNumber("1 234,56")).toBe(1234.56);
    expect(parseImportNumber("1 234,56")).toBe(1234.56);
    expect(parseImportNumber("1 234 567.89")).toBe(1234567.89);
  });

  it("reads an accounting negative as negative", () => {
    expect(parseImportNumber("(1.234,56)")).toBe(-1234.56);
    expect(parseImportNumber("(500)")).toBe(-500);
  });

  it("reads a trailing minus as negative", () => {
    // How some MT4 exports write a debit.
    expect(parseImportNumber("1234.56-")).toBe(-1234.56);
  });

  it("does not let two negatives cancel into a positive by accident", () => {
    // A leading AND a trailing sign is not a convention anyone uses; it is a
    // corrupt cell, and reading it as positive would be the worst outcome.
    expect(parseImportNumber("-1234-")).toBeNull();
  });
});
