import { describe, expect, it } from "vitest";
import {
  deepInDrawdownDay,
  flipFlopDay,
  highConvictionDay,
  leftMoneyOnTable,
  lowEfficiencyDay,
  overconfidence,
  overtradingDay,
  patiencePaidOff,
  perfectDay,
  sizingProblemDay,
} from "./day-rules";
import { ctxOf, fired, mkTrade } from "./test-helpers";

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

// Ten ordinary trading days of two trades each, so the day baselines mean something.
function baselineDays() {
  return Array.from({ length: 10 }, (_, di) => {
    const day = `2026-09-${String(di + 1).padStart(2, "0")}`;
    return Array.from({ length: 2 }, (_, i) =>
      mkTrade({
        id: `b${di}-${i}`,
        net: 200,
        openedAt: `${day}T14:00:00Z`,
        closedAt: `${day}T14:30:00Z`,
        durationSeconds: 1800,
      }),
    );
  }).flat();
}

const onDay = (day: string, id: string, net: number) =>
  mkTrade({ id, net, r: net / 100, openedAt: `${day}T14:00:00Z`, closedAt: `${day}T14:10:00Z`, durationSeconds: 600 });

describe("overtradingDay", () => {
  it("fires for a day far above the daily average", () => {
    const busy = Array.from({ length: 8 }, (_, i) => onDay("2026-09-21", `busy${i}`, -20));
    const ctx = ctxOf([...baselineDays(), ...busy]);
    expect(fired(overtradingDay, ctx)).toEqual(["2026-09-21"]);
    expect(overtradingDay.evaluate(ctx)[0].severity).toBe("critical");
  });

  it("does not fire on an ordinary day, nor before ten days of history", () => {
    expect(fired(overtradingDay, ctxOf(baselineDays()))).toEqual([]);
    const young = Array.from({ length: 8 }, (_, i) => onDay("2026-09-21", `y${i}`, -20));
    expect(fired(overtradingDay, ctxOf([...baselineDays().slice(0, 6), ...young]))).toEqual([]);
  });
});

describe("lowEfficiencyDay", () => {
  it("fires when many trades produced a fraction of a normal green day", () => {
    const grind = Array.from({ length: 5 }, (_, i) => onDay("2026-09-21", `g${i}`, 4));
    const ctx = ctxOf([...baselineDays(), ...grind]);
    expect(fired(lowEfficiencyDay, ctx)).toEqual(["2026-09-21"]);
  });
});

describe("patiencePaidOff", () => {
  // 29.09.2026 is US summer time: 09:30 ET = 13:30 UTC.
  const day = (openedAt: string, net: number) =>
    mkTrade({ id: openedAt, net, openedAt, closedAt: "2026-09-29T19:00:00Z", durationSeconds: 600 });

  it("fires on a green day whose first entry came after the opening half hour", () => {
    const ctx = ctxOf([day("2026-09-29T14:15:00Z", 300)]);
    expect(fired(patiencePaidOff, ctx)).toEqual(["2026-09-29"]);
    expect(patiencePaidOff.evaluate(ctx)[0].detail).toContain("45 min after the 09:30 ET open");
  });

  it("reads the day's FIRST entry, and needs a green day", () => {
    expect(fired(patiencePaidOff, ctxOf([day("2026-09-29T14:15:00Z", 300), day("2026-09-29T13:35:00Z", 50)]))).toEqual([]);
    expect(fired(patiencePaidOff, ctxOf([day("2026-09-29T14:15:00Z", -300)]))).toEqual([]);
  });

  it("does not count a pre-open or overnight first entry as patience", () => {
    expect(fired(patiencePaidOff, ctxOf([day("2026-09-29T12:00:00Z", 300)]))).toEqual([]);
  });
});

describe("deepInDrawdownDay — the day's time in trades underwater (F5.3b)", () => {
  const t = (id: string, net: number, underwaterPct: number | null, durationSeconds: number) =>
    mkTrade({ id, net, underwaterPct, durationSeconds, closedAt: "2026-09-29T15:00:00Z" });

  it("weights each trade by its length", () => {
    // 90% of 30 min + 10% of 10 min = 28 of 40 min = 70% — under the line.
    expect(fired(deepInDrawdownDay, ctxOf([t("a", -100, 90, 1800), t("b", 50, 10, 600)]))).toEqual([]);
    // 90% of 30 min + 50% of 10 min = 32 of 40 min = 80%.
    const ctx = ctxOf([t("a", -100, 90, 1800), t("b", 50, 50, 600)]);
    expect(fired(deepInDrawdownDay, ctx)).toEqual(["2026-09-29"]);
    expect(deepInDrawdownDay.evaluate(ctx)[0]).toMatchObject({ severity: "critical" });
    expect(deepInDrawdownDay.evaluate(ctx)[0].detail).toContain("80% of the time in them in the red");
  });

  it("says nothing unless every trade of the day was measured", () => {
    expect(fired(deepInDrawdownDay, ctxOf([t("a", -100, 95, 1800), t("b", 50, null, 600)]))).toEqual([]);
  });
});
