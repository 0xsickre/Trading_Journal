import { describe, expect, it } from "vitest";
import {
  autoExitReason,
  gradeFromRating,
  GRADE_RATING,
  minutesAgo,
  quickLogProblem,
  quickLogToTradeInput,
  quickLogWarnings,
  type QuickLogInput,
} from "./quick-log";
import { matchImportRow } from "./import-match";

const MNQ = { symbol: "MNQ", point_value: 2, tick_size: 0.25, commission_per_lot: 0.61, commission_pct: 0 };
const EXIT_REASONS = ["Target hit", "Stop hit", "Breakeven", "Trailing stop", "Closed early", "Time exit"];

function q(over: Partial<QuickLogInput> = {}): QuickLogInput {
  return {
    accountId: "00000000-0000-4000-8000-000000000001",
    instrument: MNQ,
    direction: "Short",
    contracts: 2,
    entry: 30584,
    stop: 30604,
    target: 30544,
    exit: 30600.25,
    enteredAt: "2026-09-28T13:40:00.000Z",
    exitedAt: "2026-09-28T13:52:00.000Z",
    playbookId: "00000000-0000-4000-8000-0000000000aa",
    grade: "B",
    mistakes: ["Moved stop"],
    emotions: [],
    note: "  chased the second push ",
    snapshotUrl: "",
    ...over,
  };
}

describe("grades", () => {
  it("A/B/C sit on the 1–5 execution rating and read back", () => {
    expect(GRADE_RATING).toEqual({ A: 5, B: 3, C: 1 });
    expect(gradeFromRating(5)).toBe("A");
    expect(gradeFromRating(4)).toBe("B");
    expect(gradeFromRating(3)).toBe("B");
    expect(gradeFromRating(2)).toBe("C");
    expect(gradeFromRating(1)).toBe("C");
    expect(gradeFromRating(null)).toBeNull();
    expect(gradeFromRating(0)).toBeNull();
  });
});

describe("quickLogProblem", () => {
  it("accepts a complete short", () => {
    expect(quickLogProblem(q())).toBeNull();
  });
  it.each([
    [{ instrument: null }, "Pick an instrument."],
    [{ contracts: 0 }, "whole number"],
    [{ contracts: 1.5 }, "whole number"],
    [{ entry: null }, "Entry price"],
    [{ exit: null }, "Exit price"],
    [{ enteredAt: null }, "Entry time"],
    [{ exitedAt: "nope" }, "Exit time"],
    [{ enteredAt: "2026-09-28T14:00:00.000Z" }, "after the exit"],
    [{ stop: 30570 }, "stop above"],
    [{ direction: "Long" as const, stop: 30570, target: 30500 }, "target above"],
  ])("refuses %o", (over, msg) => {
    expect(quickLogProblem(q(over))).toContain(msg);
  });
  it("a missing stop is a warning, not a refusal", () => {
    const x = q({ stop: null, playbookId: null, grade: null });
    expect(quickLogProblem(x)).toBeNull();
    expect(quickLogWarnings(x)).toHaveLength(3);
    expect(quickLogWarnings(q())).toEqual([]);
  });
});

describe("autoExitReason", () => {
  const base = { direction: "Short", entry: 30584, stop: 30604, target: 30544, tickSize: 0.25, options: EXIT_REASONS };
  it("reads the stop, the target, break-even and a manual close off the exit price", () => {
    expect(autoExitReason({ ...base, exit: 30604.5 })).toBe("Stop hit");
    expect(autoExitReason({ ...base, exit: 30544 })).toBe("Target hit");
    expect(autoExitReason({ ...base, exit: 30584.25 })).toBe("Breakeven");
    expect(autoExitReason({ ...base, exit: 30600.25 })).toBe("Closed early");
  });
  it("writes nothing the trader's list does not offer", () => {
    expect(autoExitReason({ ...base, exit: 30604, options: ["Stopped"] })).toBeNull();
    expect(autoExitReason({ ...base, exit: null })).toBeNull();
  });
  it("without a tick size only an exact price counts", () => {
    expect(autoExitReason({ ...base, tickSize: null, exit: 30604 })).toBe("Stop hit");
    expect(autoExitReason({ ...base, tickSize: null, exit: 30604.25 })).toBe("Closed early");
  });
});

describe("quickLogToTradeInput", () => {
  it("says it is a log, so a blown prop-firm account still takes the record", () => {
    expect(quickLogToTradeInput(q(), EXIT_REASONS).origin).toBe("log");
  });

  it("is one entry and one exit, commission per side, the plan columns and the review", () => {
    const t = quickLogToTradeInput(q(), EXIT_REASONS);
    expect(t.executions).toEqual([
      { side: "entry", price: 30584, qty: 2, executed_at: "2026-09-28T13:40:00.000Z", fee: 1.22, source: "manual" },
      { side: "exit", price: 30600.25, qty: 2, executed_at: "2026-09-28T13:52:00.000Z", fee: 1.22, source: "manual" },
    ]);
    expect(t.fields).toMatchObject({
      instrument: "MNQ",
      direction: "Short",
      entry_price: 30584,
      stop_price: 30604,
      target_price: 30544,
      execution_rating: 3,
      mistake: ["Moved stop"],
      exit_reason: "Closed early",
      trade_journal_notes: "chased the second push",
    });
    expect(t.fields).not.toHaveProperty("psychology_tags");
    expect(t.trade_phase).toBe("active");
    expect(t.images).toEqual([]);
  });
  it("carries the snapshot as the exit chart and empty answers as nulls", () => {
    const t = quickLogToTradeInput(
      q({ grade: null, mistakes: [], note: " ", stop: null, target: null, snapshotUrl: " https://www.tradingview.com/x/abc/ " }),
      EXIT_REASONS,
    );
    expect(t.images).toEqual([{ kind: "ltf_post", image_url: "https://www.tradingview.com/x/abc/" }]);
    expect(t.fields.execution_rating).toBeNull();
    expect(t.fields.trade_journal_notes).toBeNull();
    expect(t.fields.stop_price).toBeNull();
    expect(t.fields).not.toHaveProperty("mistake");
  });
});

describe("the day's export finds a trade logged by hand", () => {
  it("rough prices and a rough entry time still MATCH the TopstepX row", () => {
    const logged = quickLogToTradeInput(q({ enteredAt: minutesAgo(15, new Date("2026-09-28T13:55:00Z")) }), EXIT_REASONS);
    const outcome = matchImportRow(
      {
        instrument: "MNQZ6",
        direction: "Short",
        accountId: logged.account_id,
        entryTime: "2026-09-28T13:42:31.000Z",
        entryPrice: 30583.5,
        exitPrice: 30600.25,
        entryQty: 2,
        pnl: -35.72,
        pnlBasis: "net",
      },
      [
        {
          id: "p1",
          instrument: "MNQ",
          direction: "Short",
          accountId: logged.account_id,
          openedAt: logged.executions[0].executed_at,
          avgEntry: 30584,
          avgExit: 30600.25,
          entryQty: 2,
          totalFees: 2.44,
          grossPl: -32.5,
          netPl: -34.94,
        },
      ],
      (a, b) => a.replace(/Z6$/, "") === b.replace(/Z6$/, ""),
    );
    expect(outcome.status).toBe("match");
  });
});
