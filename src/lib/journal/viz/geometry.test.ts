import { describe, expect, it } from "vitest";
import {
  dashArc,
  fraction,
  semiArc,
  sparkPoints,
  splitShares,
} from "./geometry";

/**
 * The rule these tests exist to hold: NO DATA AND ZERO MUST NOT DRAW ALIKE.
 *
 * Every function here answers `null` (or an empty fill) for missing input and
 * something visibly different for a real zero. That is not a style preference —
 * a shape is read before a number is, so a gauge that draws "empty" for both
 * tells the reader a book with no trades has a 0 % win rate. `sickre-score.ts`
 * fixed exactly this bug one layer up, where an empty account scored 33/100
 * with "Max drawdown: 100"; these are the same stakes at the pixel.
 */

describe("fraction", () => {
  it("places a value in its range as 0…1", () => {
    expect(fraction(50, 0, 100)).toBe(0.5);
    expect(fraction(0, 0, 100)).toBe(0);
    expect(fraction(100, 0, 100)).toBe(1);
  });

  it("clamps outside the range rather than overflowing the arc", () => {
    expect(fraction(150, 0, 100)).toBe(1);
    expect(fraction(-20, 0, 100)).toBe(0);
  });

  it("answers null for missing input, never 0", () => {
    // The whole point. A `0` here would fill nothing and read as "measured
    // zero" — indistinguishable from a real bottom-of-range value.
    expect(fraction(null, 0, 100)).toBeNull();
    expect(fraction(undefined, 0, 100)).toBeNull();
    expect(fraction(NaN, 0, 100)).toBeNull();
  });

  it("treats Infinity as the maximum, not as missing", () => {
    // A profit factor with no losing trades IS the top of the scale, and
    // `scoreFromBands` already scores it that way. A ring that emptied itself
    // on a flawless book would say the opposite of the truth.
    expect(fraction(Infinity, 0, 3)).toBe(1);
    expect(fraction(-Infinity, 0, 3)).toBe(0);
  });

  it("answers null for a zero-width range instead of guessing 0", () => {
    expect(fraction(5, 5, 5)).toBeNull();
    expect(fraction(5, 10, 0)).toBeNull();
  });
});

describe("semiArc", () => {
  it("insets by half a stroke so the cap is not clipped", () => {
    // width 64, stroke 6 ⇒ r = 29, cx = 32, cy = 3 + 29 = 32.
    const arc = semiArc(64, 6);
    expect(arc.d).toBe("M 3 32 A 29 29 0 0 1 61 32");
    expect(arc.height).toBe(35); // r + stroke
  });

  it("reports its own length, so the fill traces the same path", () => {
    const arc = semiArc(64, 6);
    expect(arc.length).toBeCloseTo(Math.PI * 29, 10);
  });

  it("does not go negative when the stroke is wider than the box", () => {
    const arc = semiArc(4, 10);
    expect(arc.length).toBe(0);
  });
});

describe("dashArc", () => {
  it("splits the path into a filled dash and the remaining gap", () => {
    expect(dashArc(0.25, 100)).toEqual({ dash: 25, gap: 75 });
    expect(dashArc(1, 100)).toEqual({ dash: 100, gap: 0 });
  });

  it("draws NOTHING for null — the track alone", () => {
    expect(dashArc(null, 100)).toEqual({ dash: 0, gap: 100 });
  });

  it("draws nothing for a real zero too, and that is fine", () => {
    // The distinction between "no data" and "zero" is carried by the CALLER
    // omitting the fill element entirely for null — see `tile-visuals.tsx`.
    // Here both are legitimately an empty dash.
    expect(dashArc(0, 100)).toEqual({ dash: 0, gap: 100 });
  });

  it("clamps rather than overdrawing the arc", () => {
    expect(dashArc(1.5, 100)).toEqual({ dash: 100, gap: 0 });
    expect(dashArc(-0.5, 100)).toEqual({ dash: 0, gap: 100 });
  });
});

describe("splitShares", () => {
  it("reports two magnitudes as percentages that add to 100", () => {
    const s = splitShares(300, -100);
    expect(s).not.toBeNull();
    expect(s!.left).toBe(75);
    expect(s!.right).toBe(25);
    expect(s!.left + s!.right).toBe(100);
  });

  it("is sign-agnostic — an average loss arrives negative", () => {
    expect(splitShares(300, -100)).toEqual(splitShares(300, 100));
  });

  it("answers null when either side has no data", () => {
    // A full green bar with no average loss behind it reads as "all winners"
    // when it actually means "not enough trades to say".
    expect(splitShares(300, null)).toBeNull();
    expect(splitShares(null, 100)).toBeNull();
    expect(splitShares(null, null)).toBeNull();
  });

  it("answers null when both sides are zero — there is nothing to split", () => {
    expect(splitShares(0, 0)).toBeNull();
  });

  it("answers null for non-finite input rather than drawing NaN", () => {
    expect(splitShares(Infinity, 100)).toBeNull();
    expect(splitShares(300, NaN)).toBeNull();
  });
});

describe("sparkPoints", () => {
  it("maps a rising series bottom-left to top-right", () => {
    // SVG y grows downward, so the largest value must land on the SMALLEST y.
    const pts = sparkPoints([0, 5, 10], 100, 20);
    expect(pts).toBe("0,20 50,10 100,0");
  });

  it("normalizes to the series' own window, not an absolute scale", () => {
    // Same shape, different magnitudes — the drawing is identical, because the
    // number beside it is what carries magnitude.
    expect(sparkPoints([100, 105, 110], 100, 20)).toBe(
      sparkPoints([0, 5, 10], 100, 20),
    );
  });

  it("draws a flat series flat, rather than dividing by its zero range", () => {
    expect(sparkPoints([7, 7, 7], 100, 20)).toBe("0,10 50,10 100,10");
  });

  it("draws one point as a flat line, not a dot or an invented slope", () => {
    expect(sparkPoints([42], 100, 20)).toBe("0,10 100,10");
  });

  it("draws nothing at all for an empty series", () => {
    expect(sparkPoints([], 100, 20)).toBe("");
  });

  it("skips non-finite values instead of collapsing the whole line", () => {
    expect(sparkPoints([0, NaN, 10], 100, 20)).toBe("0,20 100,0");
  });

  it("insets so a stroke at the extremes is not clipped", () => {
    // With inset 2 the range is 2…18 rather than 0…20.
    expect(sparkPoints([0, 10], 100, 20, 2)).toBe("0,18 100,2");
  });
});
