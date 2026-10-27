import { describe, expect, it } from "vitest";
import { flatByFor, flatByResolver, planDayEndsAt, planTradingDay } from "./flat-by";

describe("flatByFor (phase X, X-9; no brief since X9)", () => {
  it("is the account's time — 16:00 CT unless set — in summer and in winter", () => {
    expect(flatByFor("2026-09-30")).toBe("2026-09-30T21:00:00.000Z"); // CDT, UTC-5
    expect(flatByFor("2026-12-15")).toBe("2026-12-15T22:00:00.000Z"); // CST, UTC-6
    expect(flatByFor("2026-09-30", "15:30")).toBe("2026-09-30T20:30:00.000Z");
  });

  it("falls back to 16:00 on an unreadable time, and has none for an invalid day", () => {
    expect(flatByFor("2026-09-30", "25:99")).toBe("2026-09-30T21:00:00.000Z");
    expect(flatByFor("2026-02-30")).toBeNull();
  });

  it("flatByResolver gives each account its own time, and 16:00 when unknown", () => {
    const of = flatByResolver([{ id: "a", flat_by: "15:45" }, { id: "b", flat_by: null }]);
    expect([of("a"), of("b"), of("gone"), of(null)]).toEqual(["15:45", "16:00", "16:00", "16:00"]);
  });
});

describe("a plan's trading day (F6, M3-A — the same rule as futures-trading prozor_plana)", () => {
  it("is the CME day it was written in, until that day's 15:10 CT flat", () => {
    expect(planTradingDay("2026-09-29T13:00:00Z")).toBe("2026-09-29");
    expect(planDayEndsAt("2026-09-29T13:00:00Z")).toBe(Date.parse("2026-09-29T20:10:00Z"));
  });

  it("moves to the next day after the flat, and past the weekend", () => {
    // 16:00 CT, after the flat and before the 17:00 reopen.
    expect(planTradingDay("2026-09-29T21:00:00Z")).toBe("2026-09-30");
    // Friday 16:30 CT and Sunday 18:00 CT both plan Monday.
    expect(planTradingDay("2026-10-02T21:30:00Z")).toBe("2026-10-05");
    expect(planTradingDay("2026-10-04T23:00:00Z")).toBe("2026-10-05");
  });

  it("has no day for an unreadable instant", () => {
    expect(planTradingDay(null)).toBe("");
    expect(Number.isNaN(planDayEndsAt("nope"))).toBe(true);
  });
});
