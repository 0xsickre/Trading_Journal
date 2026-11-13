import { describe, expect, it } from "vitest";
import { blindReviewHidden } from "./blind-review";
import { GRADE_RATING, NO_MISTAKE } from "./quick-log";

const TERMINAL = { kind: "terminal", id: "RP Ulaz 3f9a1c" } as const;
const base = { terminal: TERMINAL, missed: false, poiStrong: null, rating: null, mistake: [] as string[] };

describe("blindReviewHidden (phase SP): is the result kept back until the three answers are saved?", () => {
  it("hides the result of a Terminal trade with nothing answered", () => {
    expect(blindReviewHidden(base)).toBe(true);
  });

  it("keeps hiding it while any one of the three is missing", () => {
    expect(blindReviewHidden({ ...base, poiStrong: true, rating: GRADE_RATING.A })).toBe(true); // no mistake yet
    expect(blindReviewHidden({ ...base, rating: GRADE_RATING.A, mistake: [NO_MISTAKE] })).toBe(true); // no POI
    expect(blindReviewHidden({ ...base, poiStrong: false, mistake: [NO_MISTAKE] })).toBe(true); // no grade
  });

  it("shows it once POI, plan grade and mistake are all answered (A carries 'Bez greške')", () => {
    expect(blindReviewHidden({ ...base, poiStrong: true, rating: GRADE_RATING.A, mistake: [NO_MISTAKE] })).toBe(false);
    expect(blindReviewHidden({ ...base, poiStrong: false, rating: GRADE_RATING.B, mistake: ["Prerano"] })).toBe(false);
  });

  it("a B or C with no mistake picked still hides it, and 'Bez greške' does not count for them", () => {
    expect(blindReviewHidden({ ...base, poiStrong: true, rating: GRADE_RATING.C, mistake: [] })).toBe(true);
    expect(blindReviewHidden({ ...base, poiStrong: true, rating: GRADE_RATING.C, mistake: [NO_MISTAKE] })).toBe(true);
  });

  it("never hides anything outside the Terminal, on a missed setup, or when the origin is unknown", () => {
    expect(blindReviewHidden({ ...base, terminal: { kind: "van" } })).toBe(false);
    expect(blindReviewHidden({ ...base, terminal: null })).toBe(false);
    expect(blindReviewHidden({ ...base, missed: true })).toBe(false);
  });
});
