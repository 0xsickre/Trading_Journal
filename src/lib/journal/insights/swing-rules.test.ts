import { describe, expect, it } from "vitest";
import {
  entryWithoutThesis,
  pastTimeStop,
  thesisInvalidatedButHeld,
  touchedAnIntactThesis,
  unplannedPartial,
  weekendHoldRecord,
} from "./swing-rules";
import { ctxOf, fired, mkCheckin, mkTrade } from "./test-helpers";

describe("thesisInvalidatedButHeld", () => {
  it("fires when the thesis died before the position did", () => {
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-09T09:00:00Z",
        }),
      ],
      { checkins: [mkCheckin("a", "2026-01-07", { thesis_state: "invalidated" })] },
    );
    expect(fired(thesisInvalidatedButHeld, ctx)).toEqual(["a"]);
  });

  it("does NOT fire when it was closed the same day", () => {
    // Calling the thesis dead and acting on it that day is the discipline this
    // rule is looking for, not a violation of it.
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-07T20:00:00Z",
        }),
      ],
      { checkins: [mkCheckin("a", "2026-01-07", { thesis_state: "invalidated" })] },
    );
    expect(fired(thesisInvalidatedButHeld, ctx)).toEqual([]);
  });

  it("does not fire on a thesis that only weakened", () => {
    const ctx = ctxOf(
      [mkTrade({ id: "a", closedAt: "2026-01-09T09:00:00Z" })],
      { checkins: [mkCheckin("a", "2026-01-06", { thesis_state: "weakened" })] },
    );
    expect(fired(thesisInvalidatedButHeld, ctx)).toEqual([]);
  });

  it("dates the breach from the FIRST invalidated day, not the last", () => {
    // The day the decision to keep holding was made is the day it was first
    // known — reporting the last one would understate how long it ran on.
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-09T09:00:00Z",
        }),
      ],
      {
        checkins: [
          mkCheckin("a", "2026-01-08", { thesis_state: "invalidated" }),
          mkCheckin("a", "2026-01-06", { thesis_state: "invalidated" }),
        ],
      },
    );
    const [insight] = thesisInvalidatedButHeld.evaluate(ctx);
    expect(insight.detail).toContain("2026-01-06");
  });

  it("fires whatever the outcome — a win here is the expensive kind", () => {
    const ctx = ctxOf(
      [
        mkTrade({
          id: "a",
          net: 900,
          r: 9,
          openedAt: "2026-01-05T09:00:00Z",
          closedAt: "2026-01-09T09:00:00Z",
        }),
      ],
      { checkins: [mkCheckin("a", "2026-01-06", { thesis_state: "invalidated" })] },
    );
    expect(fired(thesisInvalidatedButHeld, ctx)).toEqual(["a"]);
  });

  it("stays silent with no check-ins at all", () => {
    const ctx = ctxOf([mkTrade({ id: "a" })]);
    expect(fired(thesisInvalidatedButHeld, ctx)).toEqual([]);
  });
});

describe("pastTimeStop", () => {
  it("fires on a position held beyond its stop", () => {
    // Mon 5th → Fri 9th is five sessions against a three-day stop.
    const ctx = ctxOf([
      mkTrade({
        id: "a",
        timeStopDays: 3,
        openedAt: "2026-01-05T09:00:00Z",
        closedAt: "2026-01-09T09:00:00Z",
      }),
    ]);
    expect(fired(pastTimeStop, ctx)).toEqual(["a"]);
  });

  it("does not fire on the day the stop is REACHED", () => {
    // Day 3 of a 3-day stop is still the plan being followed.
    const ctx = ctxOf([
      mkTrade({
        id: "a",
        timeStopDays: 3,
        openedAt: "2026-01-05T09:00:00Z",
        closedAt: "2026-01-07T09:00:00Z",
      }),
    ]);
    expect(fired(pastTimeStop, ctx)).toEqual([]);
  });

  it("never fires on a trade with no time stop", () => {
    // No stop is UNMEASURED, not compliant. Firing here would invent a rule the
    // trader never set.
    const ctx = ctxOf([
      mkTrade({
        id: "a",
        openedAt: "2026-01-05T09:00:00Z",
        closedAt: "2026-02-20T09:00:00Z",
      }),
    ]);
    expect(fired(pastTimeStop, ctx)).toEqual([]);
  });

  it("counts sessions, not hours", () => {
    // Opened 15:50 Monday, closed 09:10 Tuesday: 0.7 of a day by the clock, two
    // sessions by the calendar. A "1 day" stop is breached.
    const ctx = ctxOf([
      mkTrade({
        id: "a",
        timeStopDays: 1,
        openedAt: "2026-01-05T15:50:00Z",
        closedAt: "2026-01-06T09:10:00Z",
        durationSeconds: 62_400,
      }),
    ]);
    expect(fired(pastTimeStop, ctx)).toEqual(["a"]);
  });
});

describe("touchedAnIntactThesis", () => {
  it("fires when the position moved on a day nothing about it had changed", () => {
    const ctx = ctxOf([mkTrade({ id: "a" })], {
      checkins: [
        mkCheckin("a", "2026-01-06", {
          thesis_state: "intact",
          touched: "stop_moved",
        }),
      ],
    });
    expect(fired(touchedAnIntactThesis, ctx)).toEqual(["a"]);
  });

  it("does not fire when the thesis had weakened first", () => {
    // Acting on a thesis that has decayed is a judgement call, not interference.
    const ctx = ctxOf([mkTrade({ id: "a" })], {
      checkins: [
        mkCheckin("a", "2026-01-06", {
          thesis_state: "weakened",
          touched: "stop_moved",
        }),
      ],
    });
    expect(fired(touchedAnIntactThesis, ctx)).toEqual([]);
  });

  it("does not fire when the position was left alone", () => {
    const ctx = ctxOf([mkTrade({ id: "a" })], {
      checkins: [
        mkCheckin("a", "2026-01-06", {
          thesis_state: "intact",
          touched: "untouched",
        }),
      ],
    });
    expect(fired(touchedAnIntactThesis, ctx)).toEqual([]);
  });

  it("needs BOTH answers on the SAME day", () => {
    // Intact on Tuesday and touched on Thursday is not the pattern: by Thursday
    // the thesis had not been re-affirmed.
    const ctx = ctxOf([mkTrade({ id: "a" })], {
      checkins: [
        mkCheckin("a", "2026-01-06", { thesis_state: "intact" }),
        mkCheckin("a", "2026-01-08", { touched: "added" }),
      ],
    });
    expect(fired(touchedAnIntactThesis, ctx)).toEqual([]);
  });
});

describe("unplannedPartial", () => {
  it("fires on a partial exit with no scale-out written at entry", () => {
    const ctx = ctxOf([mkTrade({ id: "a" })], {
      checkins: [mkCheckin("a", "2026-01-07", { touched: "partial_exit" })],
    });
    expect(fired(unplannedPartial, ctx)).toEqual(["a"]);
  });

  it("stays silent when the partial was the plan", () => {
    // The whole point of the column: this and the case above are recorded
    // identically in the check-in, and only the written plan separates them.
    const ctx = ctxOf(
      [mkTrade({ id: "a", scaleOutPlan: "50% at 1R, rest to target" })],
      { checkins: [mkCheckin("a", "2026-01-07", { touched: "partial_exit" })] },
    );
    expect(fired(unplannedPartial, ctx)).toEqual([]);
  });

  it("treats whitespace as no plan", () => {
    const ctx = ctxOf([mkTrade({ id: "a", scaleOutPlan: "   " })], {
      checkins: [mkCheckin("a", "2026-01-07", { touched: "partial_exit" })],
    });
    expect(fired(unplannedPartial, ctx)).toEqual(["a"]);
  });

  it("does not fire on any other intervention", () => {
    // Moving a stop is a different act with its own rules. This one is about
    // taking size off.
    const ctx = ctxOf([mkTrade({ id: "a" })], {
      checkins: [mkCheckin("a", "2026-01-07", { touched: "stop_moved" })],
    });
    expect(fired(unplannedPartial, ctx)).toEqual([]);
  });

  it("does not fire without a check-in", () => {
    expect(fired(unplannedPartial, ctxOf([mkTrade({ id: "a" })]))).toEqual([]);
  });
});

describe("entryWithoutThesis", () => {
  const many = (n: number, thesis: string | null) =>
    Array.from({ length: n }, (_, i) =>
      mkTrade({ id: `t${thesis ? "y" : "n"}${i}`, thesis }),
    );

  it("stays silent below the sample threshold, however bad the share", () => {
    const ctx = ctxOf(many(4, null));
    expect(entryWithoutThesis.evaluate(ctx)).toEqual([]);
  });

  it("fires once for the habit, not once per trade", () => {
    const out = entryWithoutThesis.evaluate(ctx10(6));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain("6 of 10");
    expect(out[0].detail).toContain("60 %");
  });

  it("tolerates the occasional busy morning", () => {
    // 2 of 10 is 20 %, under the threshold. One unwritten thesis is not a habit.
    expect(entryWithoutThesis.evaluate(ctx10(2))).toEqual([]);
  });

  it("treats whitespace as unwritten", () => {
    const ctx = ctxOf([...many(6, "   "), ...many(4, "Real reason")]);
    expect(entryWithoutThesis.evaluate(ctx)).toHaveLength(1);
  });

  function ctx10(missing: number) {
    return ctxOf([...many(missing, null), ...many(10 - missing, "Written")]);
  }
});

describe("weekendHoldRecord", () => {
  // Fri 2026-01-02 → Mon 2026-01-05 crosses a Saturday; Mon → Fri does not.
  const over = (id: string, net: number) =>
    mkTrade({
      id,
      net,
      openedAt: "2026-01-02T12:00:00Z",
      closedAt: "2026-01-05T12:00:00Z",
    });
  const flat = (id: string, net: number) =>
    mkTrade({
      id,
      net,
      openedAt: "2026-01-05T12:00:00Z",
      closedAt: "2026-01-09T12:00:00Z",
    });

  it("stays silent below the category sample threshold", () => {
    const ctx = ctxOf([over("a", -100), over("b", -100), flat("c", 100)]);
    expect(weekendHoldRecord.evaluate(ctx)).toEqual([]);
  });

  it("warns when the weekend subset is the worse one", () => {
    const ctx = ctxOf([
      over("a", -100),
      over("b", -100),
      over("c", -100),
      over("d", -100),
      flat("e", 200),
      flat("f", 200),
    ]);
    const [insight] = weekendHoldRecord.evaluate(ctx);
    expect(insight.severity).toBe("warning");
    expect(insight.detail).toContain("4 positions crossed a weekend");
  });

  it("reports without warning when the weekend subset is the better one", () => {
    // A finding is a finding either way. Only the severity moves.
    const ctx = ctxOf([
      over("a", 300),
      over("b", 300),
      over("c", 300),
      over("d", 300),
      flat("e", -50),
      flat("f", -50),
    ]);
    const [insight] = weekendHoldRecord.evaluate(ctx);
    expect(insight.severity).toBe("info");
  });

  it("says nothing when there is nothing to compare against", () => {
    const ctx = ctxOf([over("a", 1), over("b", 1), over("c", 1), over("d", 1)]);
    expect(weekendHoldRecord.evaluate(ctx)).toEqual([]);
  });
});
