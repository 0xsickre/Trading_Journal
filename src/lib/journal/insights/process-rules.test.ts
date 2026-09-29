import { describe, expect, it } from "vitest";
import {
  lowMentalTempEntry,
  missedASetup,
  stalePlan,
} from "./process-rules";
import { ctxOf, fired, mkGradedRow, mkReport, mkTrade } from "./test-helpers";
import type { TradeRow } from "../types";

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

describe("stalePlan", () => {
  it("counts plans whose trading day is over, with no fills (M3-A)", () => {
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
// named its position, so there was no window to sweep and no caller left. The
// check-in itself left with the swing book (H1).
