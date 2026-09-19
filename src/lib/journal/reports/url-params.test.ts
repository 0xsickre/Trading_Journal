import { describe, expect, it } from "vitest";
import { asMinSample, asPnlBasis, asReportView, MIN_SAMPLE_OPTIONS } from "./url-params";
import { DEFAULT_MIN_SAMPLE } from "./engine";

describe("asMinSample", () => {
  // The regression that matters most in this file. `Number("abc")` is NaN and
  // `trades.length < NaN` is false, so a junk `?min` used to leave EVERY bucket
  // unflagged — the small-sample guard switched itself off and said nothing.
  it("never answers NaN, whatever the URL says", () => {
    for (const junk of ["abc", "", "  ", "NaN", "1e", "--3", "Infinity"]) {
      const v = asMinSample(junk);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
    }
  });

  it("falls back to the default when the param is absent", () => {
    expect(asMinSample(null)).toBe(DEFAULT_MIN_SAMPLE);
    expect(asMinSample(undefined)).toBe(DEFAULT_MIN_SAMPLE);
  });

  it("keeps a sane number", () => {
    expect(asMinSample("5")).toBe(5);
    expect(asMinSample("20")).toBe(20);
  });

  it("floors at 1, because 0 admits everything just like the bug did", () => {
    expect(asMinSample("0")).toBe(1);
    expect(asMinSample("-7")).toBe(1);
  });

  it("snaps down to an offered threshold, so the picker shows what is in force", () => {
    // `?min=7` used to leave the picker blank. Down, never up: a hand-edited
    // number must not become a STRICTER filter than the URL says.
    expect(asMinSample("7")).toBe(5);
    expect(asMinSample("2.9")).toBe(1);
    expect(asMinSample("999")).toBe(20);
    for (const o of MIN_SAMPLE_OPTIONS) expect(asMinSample(String(o))).toBe(o);
  });
});

describe("asReportView", () => {
  it("is money unless the URL asks for a percentage", () => {
    expect(asReportView("percentage")).toBe("percentage");
    // The units a cross-instrument report cannot show fall back to money.
    for (const v of ["", "dollars", "r", "pips", "privacy", "Percentage", null, undefined]) {
      expect(asReportView(v)).toBe("dollars");
    }
  });
});

describe("asPnlBasis", () => {
  it("reads gross only when the param says exactly gross", () => {
    expect(asPnlBasis("gross")).toBe("gross");
  });

  it("defaults to net for everything else, including a capitalised net", () => {
    // The cast this replaces treated anything that was not exactly "net" as
    // gross, so `?basis=Net` reported gross P&L under a toggle reading "Net".
    // The safe direction is the one the UI shows by default.
    for (const v of ["net", "Net", "NET", "Gross", "", "x", null, undefined]) {
      expect(asPnlBasis(v)).toBe("net");
    }
  });
});
