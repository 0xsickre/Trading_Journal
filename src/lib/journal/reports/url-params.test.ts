import { describe, expect, it } from "vitest";
import {
  asChartType,
  asMinSample,
  asPnlBasis,
  asViewMode,
} from "./url-params";
import { DEFAULT_MIN_SAMPLE } from "./engine";
import { VIEW_MODES } from "../units";

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

  it("truncates rather than rounds", () => {
    // `?min=2.9` must not silently become a STRICTER filter than the URL says.
    expect(asMinSample("2.9")).toBe(2);
    expect(asMinSample("1.2")).toBe(1);
  });
});

describe("asViewMode", () => {
  it("accepts every mode the UI offers", () => {
    for (const m of VIEW_MODES) expect(asViewMode(m.value)).toBe(m.value);
  });

  it("falls back to dollars for anything else", () => {
    for (const junk of ["", "Dollars", "euros", "PRIVACY", null, undefined]) {
      expect(asViewMode(junk)).toBe("dollars");
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

describe("asChartType", () => {
  it("reads line only when asked, bar otherwise", () => {
    expect(asChartType("line")).toBe("line");
    for (const v of ["bar", "Line", "", "pie", null, undefined]) {
      expect(asChartType(v)).toBe("bar");
    }
  });
});
