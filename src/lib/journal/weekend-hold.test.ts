import { describe, expect, it } from "vitest";
import { spansWeekend } from "./weekend-hold";

const NY = "America/New_York";

/**
 * The weekend flag, derived rather than asked.
 *
 * The cases that matter are the boundary ones — a stored flag would have been
 * whatever the trader remembered, and the whole reason to derive it is that the
 * memory and the dates disagree exactly here.
 */
describe("spansWeekend", () => {
  it("is false for a hold that opens and closes inside one week", () => {
    // Tue 2026-03-03 → Thu 2026-03-05
    expect(
      spansWeekend("2026-03-03T14:00:00Z", "2026-03-05T18:00:00Z", NY),
    ).toBe(false);
  });

  it("is true when the hold crosses Saturday and Sunday", () => {
    // Fri 2026-03-06 → Mon 2026-03-09
    expect(
      spansWeekend("2026-03-06T14:00:00Z", "2026-03-09T18:00:00Z", NY),
    ).toBe(true);
  });

  it("is false for a Friday open closed the same Friday", () => {
    // The common case for this book: flat by the close, no weekend exposure.
    expect(
      spansWeekend("2026-03-06T14:00:00Z", "2026-03-06T20:00:00Z", NY),
    ).toBe(false);
  });

  it("reads the days in the ACCOUNT's zone, not UTC", () => {
    // 2026-03-06 23:30 New York is 2026-03-07 04:30 UTC — Saturday in UTC,
    // still Friday for the account. A UTC reading would report a weekend
    // crossing that never happened.
    expect(
      spansWeekend("2026-03-06T20:00:00Z", "2026-03-07T04:30:00Z", NY),
    ).toBe(false);
  });

  it("counts a hold that opens ON the weekend", () => {
    // Sunday-open markets (FX). The exposure is real even if the hold is short.
    expect(
      spansWeekend("2026-03-08T22:00:00Z", "2026-03-10T14:00:00Z", NY),
    ).toBe(true);
  });

  it("is false while the trade is still open, and for a missing open", () => {
    // Not "no weekend" — unknowable. The caller decides what to show; what it
    // must not do is claim a crossing it cannot see.
    expect(spansWeekend("2026-03-06T14:00:00Z", null, NY)).toBe(false);
    expect(spansWeekend(null, "2026-03-09T14:00:00Z", NY)).toBe(false);
  });

  it("refuses a close that precedes the open rather than walking backwards", () => {
    expect(
      spansWeekend("2026-03-09T14:00:00Z", "2026-03-06T14:00:00Z", NY),
    ).toBe(false);
  });

  it("terminates on a corrupt far-future close instead of spinning", () => {
    // Bounded loop: the answer is not the point, returning at all is.
    expect(
      spansWeekend("2026-03-03T14:00:00Z", "2099-01-01T00:00:00Z", NY),
    ).toBe(true);
  });
});
