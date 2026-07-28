import { describe, expect, it } from "vitest";
import {
  againstMacroBias,
  dayKeysBetween,
  cotChase,
  lowMentalTempEntry,
  micromanagedASetup,
  missedASetup,
  stalePlan,
  swapAteTheTrade,
} from "./process-rules";
import { ctxOf, fired, mkReport, mkTrade } from "./test-helpers";
import type { TradeRow } from "../types";

describe("micromanagedASetup", () => {
  it("fires for an A-setup closed on a day you logged as violated", () => {
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
      { reports: [mkReport("2026-01-05", { micromanage: "violated" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual(["a"]);
  });

  it("fires when the violation happened mid-hold, not on the close day", () => {
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
      { reports: [mkReport("2026-01-08", { micromanage: "violated" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual(["a"]);
  });

  it("does not fire when the violation fell outside the holding window", () => {
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          setupGrade: "A",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-08T09:00:00Z",
        }),
      ],
      { reports: [mkReport("2026-01-20", { micromanage: "violated" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });

  it("does not fire when the day was logged as untouched", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", setupGrade: "A", closedAt: "2026-01-05T12:00:00Z" })],
      { reports: [mkReport("2026-01-05", { micromanage: "untouched" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });

  it("does not fire for a lower grade setup", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", setupGrade: "B", closedAt: "2026-01-05T12:00:00Z" })],
      { reports: [mkReport("2026-01-05", { micromanage: "violated" })] },
    );
    expect(fired(micromanagedASetup, ctx)).toEqual([]);
  });

  it("does not fire when no journal entry exists for that day", () => {
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
      { reports: [mkReport("2026-01-05", { mental_temp: 3 })] },
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
      { reports: [mkReport("2026-01-20", { mental_temp: 3 })] },
    );
    expect(fired(lowMentalTempEntry, ctx)).toEqual([]);
  });

  it("does not fire at or above the threshold", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", openedAt: "2026-01-05T09:00:00Z" })],
      { reports: [mkReport("2026-01-05", { mental_temp: 5 })] },
    );
    expect(fired(lowMentalTempEntry, ctx)).toEqual([]);
  });
});

describe("missedASetup", () => {
  it("counts A-grade plans that were never taken", () => {
    const rows = [
      { status: "missed", setup_grade: "A" },
      { status: "missed", setup_grade: "A" },
      { status: "missed", setup_grade: "C" },
      { status: "closed", setup_grade: "A" },
    ] as unknown as TradeRow[];
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

describe("dayKeysBetween", () => {
  it("is inclusive on both ends", () => {
    expect(dayKeysBetween("2026-01-05", "2026-01-08")).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ]);
  });

  it("handles a same-day trade", () => {
    expect(dayKeysBetween("2026-01-05", "2026-01-05")).toEqual(["2026-01-05"]);
  });

  it("crosses month and year boundaries", () => {
    expect(dayKeysBetween("2025-12-31", "2026-01-02")).toEqual([
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("degrades safely on reversed or missing input", () => {
    expect(dayKeysBetween("2026-01-08", "2026-01-05")).toEqual(["2026-01-08"]);
    expect(dayKeysBetween("", "2026-01-05")).toEqual([]);
  });
});
