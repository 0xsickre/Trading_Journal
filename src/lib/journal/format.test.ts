import { describe, expect, it } from "vitest";
import { fmtMoney, fmtNum, fmtPct, fmtR, pnlClass, sharedCurrency } from "./format";

/**
 * The presentation layer for every number on screen, and it had no test.
 *
 * These are one-liners, but they encode two decisions that matter and are easy
 * to undo by accident: **absent is not zero**, and **zero is not a loss**.
 */

describe("absent renders as an em dash, never as zero", () => {
  it("holds for every formatter", () => {
    for (const v of [null, undefined, Number.NaN]) {
      expect(fmtMoney(v)).toBe("—");
      expect(fmtNum(v)).toBe("—");
      expect(fmtR(v)).toBe("—");
      expect(fmtPct(v)).toBe("—");
    }
  });

  it("still prints a real zero", () => {
    // "No trades yet" and "broke exactly even" are different facts and must not
    // share a rendering.
    expect(fmtMoney(0)).toBe("$0.00");
    expect(fmtR(0)).toBe("0.00R");
    expect(fmtPct(0)).toBe("0.0%");
  });
});

describe("fmtMoney", () => {
  it("defaults to no sign, and adds one only when asked", () => {
    expect(fmtMoney(250)).toBe("$250.00");
    expect(fmtMoney(250, "USD", { sign: true })).toBe("+$250.00");
  });

  it("never writes a plus on a loss or a zero", () => {
    expect(fmtMoney(-250, "USD", { sign: true })).toBe("-$250.00");
    expect(fmtMoney(0, "USD", { sign: true })).toBe("$0.00");
  });

  it("honours the account currency", () => {
    expect(fmtMoney(100, "EUR")).toBe("€100.00");
  });
});

describe("fmtR", () => {
  it("signs a positive R, because R is read as a comparison", () => {
    expect(fmtR(1.25)).toBe("+1.25R");
    expect(fmtR(-1.25)).toBe("-1.25R");
  });
});

describe("pnlClass", () => {
  it("colours a win and a loss differently", () => {
    expect(pnlClass(1)).toBe("text-[var(--profit)]");
    expect(pnlClass(-1)).toBe("text-[var(--loss)]");
  });

  it("leaves zero and absent neutral, not red", () => {
    // Zero is not a loss. Colouring it red would paint every unopened trade and
    // every empty period as a losing one.
    for (const v of [0, null, undefined, Number.NaN]) {
      expect(pnlClass(v)).toBe("text-muted-foreground");
    }
  });
});

describe("sharedCurrency", () => {
  it("returns the one currency every account agrees on", () => {
    expect(sharedCurrency([{ currency: "USD" }, { currency: "USD" }])).toBe("USD");
    expect(sharedCurrency([{ currency: "EUR" }])).toBe("EUR");
  });

  it("returns null when accounts disagree — no safe number to sum money in", () => {
    // This is the caller's cue to refuse a pooled dollar figure rather than
    // add unlike units together — €500 + $300 is not $800.
    expect(sharedCurrency([{ currency: "USD" }, { currency: "EUR" }])).toBeNull();
  });

  it("returns null for an empty scope — nothing to agree on, not a free pass", () => {
    expect(sharedCurrency([])).toBeNull();
  });
});
