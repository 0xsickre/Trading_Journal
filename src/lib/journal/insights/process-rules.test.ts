import { describe, expect, it } from "vitest";
import {
  againstMacroBias,
  cotChase,
  lowMentalTempEntry,
  micromanagedASetup,
  missedASetup,
  stalePlan,
  swapAteTheTrade,
} from "./process-rules";
import { ctxOf, fired, mkCheckin, mkGradedRow, mkReport, mkTrade } from "./test-helpers";
import type { TradeRow } from "../types";

describe("micromanagedASetup", () => {
  it("fires for an A-setup you recorded moving the stop on", () => {
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          setupGrade: "A",
          net: -100,
          r: -1,
          closedAt: "2026-01-05T12:00:00Z",
        }),
      ],
      { checkins: [mkCheckin("a", "2026-01-05", { touched: "stop_moved" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual(["a"]);
  });

  it("fires when the interference was mid-hold, not on the close day", () => {
    // The behaviour being caught happens while the position is open; a swing
    // trade is almost never interfered with on the exact day it closes.
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          setupGrade: "A",
          net: -100,
          r: -1,
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-12T09:00:00Z",
        }),
      ],
      {
        checkins: [
          mkCheckin("a", "2026-01-06", { touched: "untouched" }),
          mkCheckin("a", "2026-01-08", { touched: "added" }),
        ],
      },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual(["a"]);
  });

  it("does not convict a position for what was done to ANOTHER one", () => {
    // The bug this redesign exists to fix. `micromanage` was a column on the
    // DAY, so an A-setup left strictly alone was flagged whenever some other
    // position was touched while it happened to be open.
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          setupGrade: "A",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-08T09:00:00Z",
        }),
        mkTrade({
          id: "b",
          setupGrade: "A",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-08T09:00:00Z",
        }),
      ],
      {
        checkins: [
          mkCheckin("a", "2026-01-06", { touched: "untouched" }),
          mkCheckin("b", "2026-01-06", { touched: "stop_moved" }),
        ],
      },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual(["b"]);
  });

  it("does not fire when the position was left alone", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", setupGrade: "A", closedAt: "2026-01-05T12:00:00Z" })],
      { checkins: [mkCheckin("a", "2026-01-05", { touched: "untouched" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });

  it("does not fire for a lower grade setup", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", setupGrade: "B", closedAt: "2026-01-05T12:00:00Z" })],
      { checkins: [mkCheckin("a", "2026-01-05", { touched: "stop_moved" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });

  it("does not fire when the question was never answered", () => {
    // A check-in row with no `touched` is silence, not a denial — and silence
    // is not evidence of interference.
    const ctx = ctxOf(
      [mkTrade({ id: "a", setupGrade: "A", closedAt: "2026-01-05T12:00:00Z" })],
      { checkins: [mkCheckin("a", "2026-01-05")] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });

  it("does not fire when there is no check-in at all", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", setupGrade: "A", closedAt: "2026-01-05T12:00:00Z" }),
    ]);
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });
});

describe("againstMacroBias", () => {
  it("stays silent below the category sample threshold", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", macroAlign: "Protiv bias", net: -100, r: -1 }),
      mkTrade({ id: "b", macroAlign: "Protiv bias", net: -100, r: -1 }),
    ]);
    expect(againstMacroBias.evaluate(ctx)).toEqual([]);
  });

  it("reports the category result once there is a sample", () => {
    const trades = Array.from({ length: 4 }, (_, i) =>
      mkTrade({ id: `a${i}`, macroAlign: "Protiv bias", net: -100, r: -1 }),
    );
    const out = againstMacroBias.evaluate(ctxOf(trades));
    expect(out).toHaveLength(1);
    expect(out[0].sample).toBe(4);
    expect(out[0].severity).toBe("warning");
  });

  it("softens to info when the category is actually profitable", () => {
    const trades = Array.from({ length: 4 }, (_, i) =>
      mkTrade({ id: `a${i}`, macroAlign: "Protiv bias", net: 200, r: 2 }),
    );
    expect(againstMacroBias.evaluate(ctxOf(trades))[0].severity).toBe("info");
  });
});

describe("cotChase", () => {
  it("fires when the COT filter said not to chase", () => {
    const ctx = ctxOf([
      mkTrade({ id: "a", cotFilter: "Ne chase", net: -100, r: -1 }),
    ]);
    expect(fired(cotChase, ctx)).toEqual(["a"]);
  });

  it("does not fire for other filter values", () => {
    const ctx = ctxOf([mkTrade({ id: "a", cotFilter: "Chase OK" })]);
    expect(fired(cotChase, ctx)).toEqual([]);
  });
});

describe("lowMentalTempEntry", () => {
  it("reads the OPEN day, not the close day", () => {
    // The judgement being questioned was made at entry.
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-20T09:00:00Z",
          net: -100,
          r: -1,
        }),
      ],
      { reports: [mkReport("2026-01-05", { mental_temp: 2 })] },
    );
    expect(fired(lowMentalTempEntry, ctx)).toEqual(["a"]);
  });

  it("does not fire when the low rating landed on the close day only", () => {
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-20T09:00:00Z",
        }),
      ],
      { reports: [mkReport("2026-01-20", { mental_temp: 2 })] },
    );
    expect(fired(lowMentalTempEntry, ctx)).toEqual([]);
  });

  it("does not fire at or above the threshold", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", openedAt: "2026-01-05T09:00:00Z" })],
      { reports: [mkReport("2026-01-05", { mental_temp: 3 })] },
    );
    expect(fired(lowMentalTempEntry, ctx)).toEqual([]);
  });
});

describe("missedASetup", () => {
  it("counts A-grade plans that were never taken", () => {
    const rows = [
      mkGradedRow("m1", "A", "missed"),
      mkGradedRow("m2", "A", "missed"),
      mkGradedRow("m3", "C", "missed"),
      mkGradedRow("c1", "A", "closed"),
    ];
    const out = missedASetup.evaluate(ctxOf([], { allRows: rows }));
    expect(out).toHaveLength(1);
    expect(out[0].sample).toBe(2);
  });

  it("is silent when nothing was missed", () => {
    expect(missedASetup.evaluate(ctxOf([], { allRows: [] }))).toEqual([]);
  });
});

describe("swapAteTheTrade", () => {
  it("fires when swap took a meaningful share of gross", () => {
    const ctx = ctxOf([mkTrade({ id: "a", gross: 100, net: 80, swap: 20 })]);
    expect(fired(swapAteTheTrade, ctx)).toEqual(["a"]);
  });

  it("does not treat earned carry as damage", () => {
    // Negative swap is a credit; an absolute value here would read it as a cost.
    const ctx = ctxOf([mkTrade({ id: "a", gross: 100, net: 120, swap: -20 })]);
    expect(fired(swapAteTheTrade, ctx)).toEqual([]);
  });

  it("does not fire for a negligible swap", () => {
    const ctx = ctxOf([mkTrade({ id: "a", gross: 1000, net: 995, swap: 5 })]);
    expect(fired(swapAteTheTrade, ctx)).toEqual([]);
  });

  it("does not fire when no swap was recorded", () => {
    const ctx = ctxOf([mkTrade({ id: "a", gross: 100, net: 100, swap: 0 })]);
    expect(fired(swapAteTheTrade, ctx)).toEqual([]);
  });
});

describe("stalePlan", () => {
  it("counts plans older than the threshold with no fills", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const rows = [
      { status: "planned", created_at: old },
      { status: "planned", created_at: new Date().toISOString() },
      { status: "closed", created_at: old },
    ] as unknown as TradeRow[];
    const out = stalePlan.evaluate(ctxOf([], { allRows: rows }));
    expect(out).toHaveLength(1);
    expect(out[0].sample).toBe(1);
  });

  it("is silent when every plan is fresh", () => {
    const rows = [
      { status: "planned", created_at: new Date().toISOString() },
    ] as unknown as TradeRow[];
    expect(stalePlan.evaluate(ctxOf([], { allRows: rows }))).toEqual([]);
  });
});

// `dayKeysBetween` and its four tests stood here. It existed only to sweep the
// holding window looking for a day marked as micromanaged; the check-in now
// names its position, so there is no window to sweep and no caller left. The
// equivalent day-walk that survives is `daysBetweenKeys` in `open-positions.ts`,
// which is tested there — and walks day keys rather than epoch days, so DST
// cannot round it off by one.
