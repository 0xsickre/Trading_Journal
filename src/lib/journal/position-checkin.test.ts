import { describe, expect, it } from "vitest";
import {
  THESIS_STATES,
  TOUCHED_SEVERITY,
  TOUCHED_STATES,
  isInterference,
  worstTouched,
  type TouchedState,
} from "./position-checkin";

/**
 * THE DAILY CHECK-IN ON AN OPEN POSITION.
 *
 * The module arrived after the last review and had no test at all, while
 * `worstTouched` decides what swing trades are GROUPED BY in the reports — that
 * is, which number stands next to which row.
 */

describe("worstTouched — furthest from the plan, not the worst outcome", () => {
  it("with no answer at all it returns null, not `untouched`", () => {
    // The difference is real: `untouched` means "I looked and did not touch it",
    // null means "I never showed up". The first is discipline, the second is
    // silence, and a report that mixes them would count silence as a virtue.
    expect(worstTouched([])).toBeNull();
    expect(worstTouched([null, null])).toBeNull();
  });

  it("one touch in five days is what gets remembered", () => {
    expect(
      worstTouched(["untouched", "untouched", "stop_moved", "untouched"]),
    ).toBe("stop_moved");
  });

  it("the order is distance from the plan: added > stop_moved > partial_exit > untouched", () => {
    expect(worstTouched(["added", "stop_moved"])).toBe("added");
    expect(worstTouched(["stop_moved", "partial_exit"])).toBe("stop_moved");
    expect(worstTouched(["partial_exit", "untouched"])).toBe("partial_exit");
    // A partial exit is a deviation towards LESS risk, so it sits below moving
    // the stop — which changes the loss agreed before entry.
    expect(TOUCHED_SEVERITY.partial_exit).toBeLessThan(
      TOUCHED_SEVERITY.stop_moved,
    );
  });

  it("null values are skipped and do not knock out the result", () => {
    expect(worstTouched([null, "partial_exit", null])).toBe("partial_exit");
  });

  it("the order of the inputs does not change the answer", () => {
    const states: TouchedState[] = ["untouched", "added", "partial_exit"];
    expect(worstTouched(states)).toBe("added");
    expect(worstTouched([...states].reverse())).toBe("added");
  });

  it("every state has a weight — none falls through to undefined", () => {
    for (const s of TOUCHED_STATES) {
      expect(TOUCHED_SEVERITY[s], s).toBeTypeOf("number");
    }
  });
});

describe("isInterference", () => {
  it("`untouched` is not interference, and neither is silence", () => {
    expect(isInterference("untouched")).toBe(false);
    expect(isInterference(null)).toBe(false);
  });

  it("everything else is", () => {
    expect(isInterference("partial_exit")).toBe(true);
    expect(isInterference("stop_moved")).toBe(true);
    expect(isInterference("added")).toBe(true);
  });

  it("agrees with the weight: interference is exactly what weighs above zero", () => {
    for (const s of TOUCHED_STATES) {
      expect(isInterference(s), s).toBe(TOUCHED_SEVERITY[s] > 0);
    }
  });
});

describe("the closed sets follow the CHECK in the database", () => {
  it("the thesis and touch states are exactly the ones the database accepts", () => {
    // Checked against the live CHECK on `tj_position_checkins`.
    expect([...THESIS_STATES].sort()).toEqual(
      ["intact", "invalidated", "weakened"].sort(),
    );
    expect([...TOUCHED_STATES].sort()).toEqual(
      ["added", "partial_exit", "stop_moved", "untouched"].sort(),
    );
  });

  it("the DECLARATION order is the order on screen, not the weight", () => {
    // Worth writing down because it is confusing: the list is ordered the way
    // the buttons are shown (`untouched, stop_moved, partial_exit, added`),
    // while distance from the plan is another thing and lives in
    // `TOUCHED_SEVERITY`. A test that mixes them would fail on correct code —
    // which is what happened here while writing it.
    expect([...TOUCHED_STATES]).toEqual([
      "untouched",
      "stop_moved",
      "partial_exit",
      "added",
    ]);
    expect(TOUCHED_SEVERITY.stop_moved).toBeGreaterThan(
      TOUCHED_SEVERITY.partial_exit,
    );
  });
});
