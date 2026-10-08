import { describe, expect, it } from "vitest";
import {
  exitReasonFromBracket,
  autoExitReason,
  exitReasonAfterMerge,
  gradeFromRating,
  GRADE_RATING,
} from "./quick-log";

const EXIT_REASONS = ["Pogođen target", "Pogođen stop", "Na nuli", "Prateći stop", "Zatvoreno ranije", "Izlaz po vremenu"];

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

describe("exitReasonFromBracket (phase O)", () => {
  const options = ["Pogođen stop", "Prateći stop", "Pogođen target", "Na nuli", "Zatvoreno ranije"];
  const base = { direction: "Long", entry: 30969.75, exit: 30978.5, tickSize: 0.25, options };
  it("names the order that closed the trade", () => {
    expect(exitReasonFromBracket({ ...base, exitKind: "stop", stopMovedToProfit: false })).toBe("Pogođen stop");
    expect(exitReasonFromBracket({ ...base, exitKind: "stop", stopMovedToProfit: true })).toBe("Prateći stop");
    expect(exitReasonFromBracket({ ...base, exitKind: "target", stopMovedToProfit: false })).toBe("Pogođen target");
  });
  it("reads a hand close off the prices", () => {
    expect(exitReasonFromBracket({ ...base, exitKind: "manual", stopMovedToProfit: true })).toBe("Zatvoreno ranije");
    expect(exitReasonFromBracket({ ...base, exit: 30970, exitKind: "manual", stopMovedToProfit: true })).toBe("Na nuli");
  });
});
