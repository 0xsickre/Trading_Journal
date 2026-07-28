import { describe, expect, it } from "vitest";
import {
  flipFlopDay,
  highConvictionDay,
  leftMoneyOnTable,
  overconfidence,
  perfectDay,
  sizingProblemDay,
} from "./day-rules";
import { lowEfficiencyWeek, overtradingWeek, tiltWeek } from "./week-rules";
import { ctxOf, DAY, fired, mkTrade } from "./test-helpers";

const on = (day: string) => ({
  openedAt: `${day}T09:00:00Z`,
  closedAt: `${day}T15:00:00Z`,
});

describe("perfectDay", () => {
  it("fires when every trade won and none went offside", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 100, mae: 101, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: 50, mae: 100, ...on("2026-01-05") }),
    ]);
    expect(fired(perfectDay, ctx)).toEqual(["2026-01-05"]);
  });

  it("does not fire when one trade went offside", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 100, mae: 101, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: 50, mae: 95, ...on("2026-01-05") }),
    ]);
    expect(fired(perfectDay, ctx)).toEqual([]);
  });

  it("does not fire on a day containing a loss", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 100, mae: 101, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: -50, r: -0.5, mae: 101, ...on("2026-01-05") }),
    ]);
    expect(fired(perfectDay, ctx)).toEqual([]);
  });
});

describe("highConvictionDay", () => {
  it("fires for a single trade at 2R or better", () => {
    const ctx = ctxOf([mkTrade({ id: "a", net: 300, r: 3, ...on("2026-01-05") })]);
    expect(fired(highConvictionDay, ctx)).toEqual(["2026-01-05"]);
  });

  it("does not fire when the day had more than one trade", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 300, r: 3, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: 10, r: 0.1, ...on("2026-01-05") }),
    ]);
    expect(fired(highConvictionDay, ctx)).toEqual([]);
  });
});

describe("sizingProblemDay", () => {
  it("fires when most trades won but the day still lost money", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 50, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: 50, ...on("2026-01-05") }),
      mkTrade({ id: "c", net: -400, r: -4, ...on("2026-01-05") }),
    ]);
    expect(fired(sizingProblemDay, ctx)).toEqual(["2026-01-05"]);
  });

  it("does not fire on a green day", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 300, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: -50, r: -0.5, ...on("2026-01-05") }),
    ]);
    expect(fired(sizingProblemDay, ctx)).toEqual([]);
  });
});

describe("flipFlopDay", () => {
  it("fires when both directions were traded the same day", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", direction: "Long", net: -50, r: -0.5, ...on("2026-01-05") }),
      mkTrade({ id: "b", direction: "Short", net: -60, r: -0.6, ...on("2026-01-05") }),
    ]);
    const out = flipFlopDay.evaluate(ctx);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
  });

  it("downgrades to info when the day still finished green", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", direction: "Long", net: 300, ...on("2026-01-05") }),
      mkTrade({ id: "b", direction: "Short", net: -60, r: -0.6, ...on("2026-01-05") }),
    ]);
    expect(flipFlopDay.evaluate(ctx)[0].severity).toBe("info");
  });

  it("does not fire when only one direction was traded", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", direction: "Long", net: 100, ...on("2026-01-05") }),
      mkTrade({ id: "b", direction: "Long", net: -50, r: -0.5, ...on("2026-01-05") }),
    ]);
    expect(fired(flipFlopDay, ctx)).toEqual([]);
  });
});

describe("leftMoneyOnTable", () => {
  it("sums unrealized R across the day", () => {
    // Each trade: MFE 130 → 3R available, 1R taken → 2R missed. Two trades = 4R.
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 100, r: 1, mfe: 130, ...on("2026-01-05") }),
      mkTrade({ id: "b", net: 100, r: 1, mfe: 130, ...on("2026-01-05") }),
    ]);
    expect(fired(leftMoneyOnTable, ctx)).toEqual(["2026-01-05"]);
  });

  it("stays quiet when little was left behind", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", net: 100, r: 1, mfe: 111, ...on("2026-01-05") }),
    ]);
    expect(fired(leftMoneyOnTable, ctx)).toEqual([]);
  });
});

describe("overconfidence", () => {
  it("fires when size was raised after a winning run and the trade lost", () => {
    const ctx = ctxOf([
      mkTrade({ id: "w1", net: 100, size: 1, closedAt: "2026-01-01T10:00:00Z" }),
      mkTrade({ id: "w2", net: 100, size: 1, closedAt: "2026-01-02T10:00:00Z" }),
      mkTrade({
        id: "blowup",
        net: -300,
        r: -3,
        size: 3,
        closedAt: "2026-01-03T10:00:00Z",
      }),
    ]);
    expect(fired(overconfidence, ctx)).toEqual(["blowup"]);
  });

  it("does not fire when size stayed flat", () => {
    const ctx = ctxOf([
      mkTrade({ id: "w1", net: 100, size: 1, closedAt: "2026-01-01T10:00:00Z" }),
      mkTrade({ id: "w2", net: 100, size: 1, closedAt: "2026-01-02T10:00:00Z" }),
      mkTrade({
        id: "loss",
        net: -100,
        r: -1,
        size: 1,
        closedAt: "2026-01-03T10:00:00Z",
      }),
    ]);
    expect(fired(overconfidence, ctx)).toEqual([]);
  });

  it("does not fire without a preceding winning streak", () => {
    const ctx = ctxOf([
      mkTrade({
        id: "loss1",
        net: -100,
        r: -1,
        size: 1,
        closedAt: "2026-01-01T10:00:00Z",
      }),
      mkTrade({
        id: "big",
        net: -300,
        r: -3,
        size: 3,
        closedAt: "2026-01-02T10:00:00Z",
      }),
    ]);
    expect(fired(overconfidence, ctx)).toEqual([]);
  });
});

// Five distinct weeks of ordinary activity, so week baselines are meaningful.
function baselineWeeks() {
  const mondays = [
    "2026-01-05",
    "2026-01-12",
    "2026-01-19",
    "2026-01-26",
    "2026-02-02",
  ];
  return mondays.flatMap((m, wi) =>
    Array.from({ length: 2 }, (_, i) =>
      mkTrade({
        id: `b${wi}-${i}`,
        net: 200,
        closedAt: `${m}T12:00:00Z`,
        durationSeconds: 4 * DAY,
      }),
    ),
  );
}

describe("overtradingWeek", () => {
  it("fires for a week far above the weekly average", () => {
    const busy = Array.from({ length: 12 }, (_, i) =>
      mkTrade({
        id: `busy${i}`,
        net: -20,
        r: -0.2,
        closedAt: "2026-02-09T12:00:00Z",
      }),
    );
    const ctx = ctxOf([...baselineWeeks(), ...busy]);
    expect(fired(overtradingWeek, ctx)).toContain("2026-02-09");
  });

  it("does not fire on an ordinary week", () => {
    const ctx = ctxOf(baselineWeeks());
    expect(fired(overtradingWeek, ctx)).toEqual([]);
  });
});

describe("lowEfficiencyWeek", () => {
  it("fires when many trades produced a fraction of a normal green week", () => {
    const grind = Array.from({ length: 5 }, (_, i) =>
      mkTrade({
        id: `g${i}`,
        net: 4,
        r: 0.04,
        closedAt: "2026-02-09T12:00:00Z",
      }),
    );
    const ctx = ctxOf([...baselineWeeks(), ...grind]);
    expect(fired(lowEfficiencyWeek, ctx)).toContain("2026-02-09");
  });
});

describe("tiltWeek", () => {
  it("fires on a losing week of unusually short holds", () => {
    const tilt = Array.from({ length: 4 }, (_, i) =>
      mkTrade({
        id: `t${i}`,
        net: -100,
        r: -1,
        closedAt: "2026-02-09T12:00:00Z",
        durationSeconds: 0.2 * DAY,
      }),
    );
    const ctx = ctxOf([...baselineWeeks(), ...tilt]);
    expect(fired(tiltWeek, ctx)).toContain("2026-02-09");
  });

  it("does not fire on a losing week that was held normally", () => {
    const slow = Array.from({ length: 4 }, (_, i) =>
      mkTrade({
        id: `s${i}`,
        net: -100,
        r: -1,
        closedAt: "2026-02-09T12:00:00Z",
        durationSeconds: 6 * DAY,
      }),
    );
    const ctx = ctxOf([...baselineWeeks(), ...slow]);
    expect(fired(tiltWeek, ctx)).toEqual([]);
  });
});
