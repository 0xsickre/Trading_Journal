import { describe, expect, it } from "vitest";
import { defaultDashboardPeriod, hiddenByPeriod } from "./default-period";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 19);
const CUT_90 = NOW - 89 * DAY;

describe("the period the dashboard opens on", () => {
  it("opens on 90 days for a live account with recent trades", () => {
    expect(defaultDashboardPeriod([NOW - 5 * DAY, Date.UTC(2018, 1, 9)], CUT_90)).toBe("90");
  });

  it("opens on ALL for a backtest whose trades all closed years ago", () => {
    // A 2018 replay: every close is outside any window counted back from today.
    expect(
      defaultDashboardPeriod([Date.UTC(2018, 1, 14), Date.UTC(2018, 2, 8)], CUT_90),
    ).toBe("all");
  });

  it("opens on 90 days when there is nothing yet — no trades is not a backtest", () => {
    expect(defaultDashboardPeriod([], CUT_90)).toBe("90");
  });
});

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
