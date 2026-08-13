import { describe, expect, it } from "vitest";
import { buildWeekRecap } from "./week-recap";
import { enrich, mkCheckin } from "./reports/test-helpers";

// 2026-01-05 Mon … 2026-01-11 Sun.
const MON = "2026-01-05";

const recap = (
  trades: Parameters<typeof enrich>[0],
  checkins: Parameters<typeof buildWeekRecap>[1] = [],
  dates: string[] = [],
) => buildWeekRecap(enrich(trades), checkins, new Set(dates), MON);

describe("buildWeekRecap — trades", () => {
  it("counts trades by their CLOSE day, inside the week", () => {
    const r = recap([
      { id: "a", closedAt: "2026-01-06T12:00:00Z", net: 200 },
      { id: "b", closedAt: "2026-01-09T12:00:00Z", net: -50 },
    ]);
    expect(r.closed).toBe(2);
    expect(r.net).toBe(150);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
  });

  it("includes both edges of the week", () => {
    const r = recap([
      { id: "a", closedAt: "2026-01-05T00:30:00Z" },
      { id: "b", closedAt: "2026-01-11T23:30:00Z" },
    ]);
    expect(r.closed).toBe(2);
  });

  it("excludes a trade that closed outside the week", () => {
    const r = recap([
      { id: "a", closedAt: "2026-01-04T12:00:00Z" },
      { id: "b", closedAt: "2026-01-12T12:00:00Z" },
    ]);
    expect(r.closed).toBe(0);
    expect(r.net).toBe(0);
  });

  it("keeps a position that OPENED in an earlier week", () => {
    // The money lands in the week it closed, and that is the week whose numbers
    // must agree with the calendar cell.
    const r = recap([
      { id: "a", openedAt: "2025-12-30T12:00:00Z", closedAt: "2026-01-06T12:00:00Z" },
    ]);
    expect(r.closed).toBe(1);
  });

  it("counts weekend holds among them", () => {
    const r = recap([
      // Fri → Mon crosses a Saturday.
      { id: "a", openedAt: "2026-01-02T12:00:00Z", closedAt: "2026-01-05T12:00:00Z" },
      // Mon → Fri does not.
      { id: "b", openedAt: "2026-01-05T12:00:00Z", closedAt: "2026-01-09T12:00:00Z" },
    ]);
    expect(r.closed).toBe(2);
    expect(r.weekendHolds).toBe(1);
  });
});

describe("buildWeekRecap — check-ins", () => {
  it("counts positions, not rows — five days of one hold is one position", () => {
    const r = recap(
      [],
      [
        mkCheckin("p1", "2026-01-05", { touched: "untouched" }),
        mkCheckin("p1", "2026-01-06", { touched: "untouched" }),
        mkCheckin("p1", "2026-01-07", { touched: "stop_moved" }),
      ],
    );
    expect(r.checkedPositions).toBe(1);
    expect(r.interferedPositions).toBe(1);
  });

  it("counts a check-in in the week even when its trade closed later", () => {
    // The check-in is dated on its own day. A position judged all week and
    // closed on Monday still earns this week credit for the judging.
    const r = recap([], [mkCheckin("p1", "2026-01-08", { thesis_state: "intact" })]);
    expect(r.checkedPositions).toBe(1);
  });

  it("ignores check-ins outside the week", () => {
    const r = recap([], [mkCheckin("p1", "2026-01-13", { touched: "added" })]);
    expect(r.checkedPositions).toBe(0);
    expect(r.interferedPositions).toBe(0);
  });

  it("does not count 'untouched' or an unanswered row as interference", () => {
    const r = recap(
      [],
      [
        mkCheckin("p1", "2026-01-06", { touched: "untouched" }),
        mkCheckin("p2", "2026-01-06"),
      ],
    );
    expect(r.checkedPositions).toBe(2);
    expect(r.interferedPositions).toBe(0);
  });

  it("counts weakened and invalidated alike as the thesis slipping", () => {
    // Weakened is the state a swing position actually spends its time in, and
    // holding through it is a decision worth being able to count.
    const r = recap(
      [],
      [
        mkCheckin("p1", "2026-01-06", { thesis_state: "weakened" }),
        mkCheckin("p2", "2026-01-06", { thesis_state: "invalidated" }),
        mkCheckin("p3", "2026-01-06", { thesis_state: "intact" }),
      ],
    );
    expect(r.thesisSlippedPositions).toBe(2);
  });
});

describe("buildWeekRecap — journalled days", () => {
  it("counts only dates inside the week", () => {
    const r = recap([], [], ["2026-01-05", "2026-01-08", "2026-01-12"]);
    expect(r.journalledDays).toBe(2);
  });

  it("is zero when nothing was written", () => {
    expect(recap([]).journalledDays).toBe(0);
  });
});
