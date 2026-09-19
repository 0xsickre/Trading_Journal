import { describe, expect, it } from "vitest";
import { hiddenByPeriod } from "./default-period";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 19);
const CUT_90 = NOW - 89 * DAY;

describe("what a period is hiding", () => {
  it("counts the trades outside the window and names the oldest", () => {
    const old1 = Date.UTC(2018, 1, 14);
    const old2 = Date.UTC(2018, 2, 8);
    expect(hiddenByPeriod([old1, old2, NOW], CUT_90)).toEqual({ count: 2, oldestMs: old1 });
  });

  it("says nothing when the window hides nothing, or there is no window", () => {
    expect(hiddenByPeriod([NOW], CUT_90)).toBeNull();
    expect(hiddenByPeriod([Date.UTC(2018, 1, 14)], null)).toBeNull();
  });
});
