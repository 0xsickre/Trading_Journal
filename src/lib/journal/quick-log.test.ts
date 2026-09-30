import { describe, expect, it } from "vitest";
import {
  autoExitReason,
  exitReasonAfterMerge,
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
const EXIT_REASONS = ["Pogođen target", "Pogođen stop", "Na nuli", "Prateći stop", "Zatvoreno ranije", "Izlaz po vremenu"];

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
    mistakes: ["Pomerio stop"],
    emotions: [],
    note: "  chased the second push ",
    entrySnapshotUrl: "",
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
    [{ exit: 0 }, "Exit price"],
    [{ enteredAt: null }, "Entry time"],
    [{ exitedAt: "nope" }, "Exit time"],
    [{ enteredAt: "2026-09-28T14:00:00.000Z" }, "after the exit"],
    [{ stop: 30570 }, "stop above"],
    [{ direction: "Long" as const, stop: 30570, target: 30500 }, "target above"],
  ])("refuses %o", (over, msg) => {
    expect(quickLogProblem(q(over))).toContain(msg);
  });
  it("no exit is a trade still running: saved open, with only the entry fill", () => {
    const open = q({ exit: null, exitedAt: null, snapshotUrl: "" });
    expect(quickLogProblem(open)).toBeNull();
    const t = quickLogToTradeInput(open, EXIT_REASONS);
    expect(t.executions.map((e) => e.side)).toEqual(["entry"]);
    expect(t.fields).not.toHaveProperty("exit_reason");
    // The side checks still apply to an open trade.
    expect(quickLogProblem(q({ exit: null, stop: 30570 }))).toContain("stop above");
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
    expect(autoExitReason({ ...base, exit: 30604.5 })).toBe("Pogođen stop");
    expect(autoExitReason({ ...base, exit: 30544 })).toBe("Pogođen target");
    expect(autoExitReason({ ...base, exit: 30584.25 })).toBe("Na nuli");
    expect(autoExitReason({ ...base, exit: 30600.25 })).toBe("Zatvoreno ranije");
  });
  it("writes nothing the trader's list does not offer", () => {
    expect(autoExitReason({ ...base, exit: 30604, options: ["Stopped"] })).toBeNull();
    expect(autoExitReason({ ...base, exit: null })).toBeNull();
  });
  it("a stop-market fill THROUGH the stop is still the stop, however many ticks", () => {
    // Short, stop 30604: a fast tape fills it at 30606 — eight ticks through.
    expect(autoExitReason({ ...base, exit: 30606 })).toBe("Pogođen stop");
    expect(autoExitReason({ ...base, direction: "Long", entry: 30584, stop: 30564, target: 30624, exit: 30561.5 })).toBe(
      "Pogođen stop",
    );
    // A target filled better than written is the target too.
    expect(autoExitReason({ ...base, exit: 30540 })).toBe("Pogođen target");
  });
  it("without a tick size the stop still counts at or past it, and nothing short of it", () => {
    expect(autoExitReason({ ...base, tickSize: null, exit: 30604 })).toBe("Pogođen stop");
    expect(autoExitReason({ ...base, tickSize: null, exit: 30604.25 })).toBe("Pogođen stop");
    expect(autoExitReason({ ...base, tickSize: null, exit: 30603.75 })).toBe("Zatvoreno ranije");
  });
  it("reads the side off the stop when no direction is given, and a stop moved into profit", () => {
    expect(autoExitReason({ ...base, direction: null, exit: 30606 })).toBe("Pogođen stop");
    // Long with the stop trailed above the entry: filled through it is still the stop.
    expect(autoExitReason({ ...base, direction: "Long", entry: 30584, stop: 30594, target: 30624, exit: 30593 })).toBe(
      "Pogođen stop",
    );
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
      mistake: ["Pomerio stop"],
      exit_reason: "Zatvoreno ranije",
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
  it("carries an entry chart as ltf_pre, before the exit chart", () => {
    const t = quickLogToTradeInput(
      q({ entrySnapshotUrl: " storage:u/entry.png ", snapshotUrl: "https://www.tradingview.com/x/abc/" }),
      EXIT_REASONS,
    );
    expect(t.images).toEqual([
      { kind: "ltf_pre", image_url: "storage:u/entry.png" },
      { kind: "ltf_post", image_url: "https://www.tradingview.com/x/abc/" },
    ]);
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

describe("exitReasonAfterMerge — the export closes a trade logged while running", () => {
  const base = { direction: "Short", stop: 30604, target: 30544, tickSize: 0.25, options: EXIT_REASONS };
  const fills = (exit: number | null, exitQty = 2) => [
    { side: "entry" as const, price: 30584, qty: 2 },
    ...(exit == null ? [] : [{ side: "exit" as const, price: exit, qty: exitQty }]),
  ];
  it("reads the reason off the statement's exit", () => {
    expect(exitReasonAfterMerge({ ...base, current: null, fills: fills(30604.5) })).toBe("Pogođen stop");
    expect(exitReasonAfterMerge({ ...base, current: null, fills: fills(30544) })).toBe("Pogođen target");
  });
  it("leaves the trader's own reason, an open trade and a partial exit alone", () => {
    expect(exitReasonAfterMerge({ ...base, current: "Prateći stop", fills: fills(30604.5) })).toBeNull();
    expect(exitReasonAfterMerge({ ...base, current: null, fills: fills(null) })).toBeNull();
    expect(exitReasonAfterMerge({ ...base, current: null, fills: fills(30544, 1) })).toBeNull();
  });
});
