import { describe, expect, it } from "vitest";
import { buildWeekRecap, weekDayRows } from "./week-recap";
import { enrich, mkCheckin, mkTrade } from "./reports/test-helpers";

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

describe("the measurements — null when there is nothing to divide by", () => {
  it("computes the ratios over the week's closed trades", () => {
    const r = recap([
      { id: "a", closedAt: "2026-01-06T12:00:00Z", net: 300, r: 2 },
      { id: "b", closedAt: "2026-01-07T12:00:00Z", net: 300, r: 2 },
      { id: "c", closedAt: "2026-01-08T12:00:00Z", net: -200, r: -1 },
    ]);
    expect(r.winRate).toBeCloseTo((2 / 3) * 100);
    expect(r.profitFactor).toBeCloseTo(600 / 200);
    expect(r.avgR).toBeCloseTo(1);
    expect(r.expectancySample).toBe(3);
  });

  it("ANSWERS null, NOT ZERO, for a week with no closed trade", () => {
    // The distinction the whole module turns on. "You had no win rate" and "your
    // win rate was 0 %" are different sentences, and only the second is a
    // verdict — which this file's header forbids it from delivering.
    const r = recap([]);
    expect(r.closed).toBe(0);
    expect(r.winRate).toBeNull();
    expect(r.profitFactor).toBeNull();
    expect(r.avgR).toBeNull();
    expect(r.expectancy).toBeNull();
    expect(r.expectancySample).toBe(0);
  });

  it("KEEPS THE RATIO CONSISTENT with the wins and losses printed beside it", () => {
    // `winRate` is derived from the same counts the card renders, not from a
    // second classification pass — so the panel can never show "3 / 1" next to
    // a percentage that does not follow from it.
    const r = recap([
      { id: "a", closedAt: "2026-01-06T12:00:00Z", net: 100 },
      { id: "b", closedAt: "2026-01-07T12:00:00Z", net: 100 },
      { id: "c", closedAt: "2026-01-08T12:00:00Z", net: 100 },
      { id: "d", closedAt: "2026-01-09T12:00:00Z", net: -100 },
    ]);
    expect(r.wins).toBe(3);
    expect(r.losses).toBe(1);
    expect(r.winRate).toBeCloseTo((r.wins / (r.wins + r.losses)) * 100);
  });

  it("reports an infinite profit factor rather than null when nothing lost", () => {
    // A week with winners and no losers divided by zero. That is a real week,
    // and collapsing it into the same null as an empty week would hide it.
    const r = recap([{ id: "a", closedAt: "2026-01-06T12:00:00Z", net: 500 }]);
    expect(r.profitFactor).toBe(Infinity);
  });
});

describe("weekDayRows — a week is seven days whatever was traded", () => {
  const rows = (specs: Parameters<typeof mkTrade>[0][]) =>
    weekDayRows(MON, specs.map(mkTrade), () => "UTC");

  it("ALWAYS RETURNS SEVEN, even for a week nothing was traded in", () => {
    // The strip drawing these is a week. Returning only the traded days would
    // make a three-day week render as a three-column strip and quietly change
    // which weekday each column meant.
    expect(rows([])).toHaveLength(7);
    expect(rows([{ id: "a", closedAt: "2026-01-07T12:00:00Z", net: 100 }])).toHaveLength(7);
  });

  it("puts each day in its own Monday-first slot", () => {
    const r = rows([
      { id: "a", closedAt: "2026-01-05T12:00:00Z", net: 100 }, // Mon
      { id: "b", closedAt: "2026-01-11T12:00:00Z", net: -40 }, // Sun
    ]);
    expect(r[0]?.net).toBe(100);
    expect(r[6]?.net).toBe(-40);
  });

  it("LEAVES AN UNTRADED DAY null RATHER THAN ZERO-FILLING IT", () => {
    // "Did not trade" and "traded to a flat result" are different facts. A
    // zero-filled row would claim the second on every day of a quiet week.
    const r = rows([{ id: "a", closedAt: "2026-01-05T12:00:00Z", net: 100 }]);
    expect(r[1]).toBeNull();
    expect(r[2]).toBeNull();
  });

  it("ignores trades that closed outside the week", () => {
    const r = rows([
      { id: "a", closedAt: "2026-01-04T12:00:00Z", net: 999 },
      { id: "b", closedAt: "2026-01-12T12:00:00Z", net: 999 },
    ]);
    expect(r.every((d) => d === null)).toBe(true);
  });
});
