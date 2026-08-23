import { describe, expect, it } from "vitest";
import {
  moveInOrder,
  moveRuleWithinSection,
  moveToIndex,
  reorderWithinSection,
  type RuleLink,
} from "./playbook-order";

/** Compact fixture: "a:entry" → { ruleId: "a", sectionId: "entry" }. */
const links = (...spec: string[]): RuleLink[] =>
  spec.map((s) => {
    const [ruleId, sectionId] = s.split(":");
    return { ruleId, sectionId: sectionId as RuleLink["sectionId"] };
  });

describe("moveRuleWithinSection", () => {
  it("swaps with the next rule of the same section", () => {
    const order = links("a:entry", "b:entry", "c:entry");
    expect(moveRuleWithinSection(order, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("swaps with the previous one going up", () => {
    const order = links("a:entry", "b:entry", "c:entry");
    expect(moveRuleWithinSection(order, "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("steps over a rule of another section, leaving it exactly where it was", () => {
    // The case this function exists for. `b` is a rule of another section that happens to
    // sit between two of them in the flat link order. Moving `a` down must
    // trade places with `c` — the next ENTRY rule — and `b` must not budge from
    // index 1, because nothing on screen draws the flat order.
    const order = links("a:entry", "b:context", "c:entry");
    expect(moveRuleWithinSection(order, "a", 1)).toEqual(["c", "b", "a"]);
  });

  it("handles a section whose members are scattered through the order", () => {
    const order = links(
      "x:context",
      "a:entry",
      "y:exit",
      "b:entry",
      "z:context",
      "c:entry",
    );
    // Entry occupies slots 1, 3, 5. Moving `b` (middle) down puts `c` in slot 3
    // and `b` in slot 5; everything else keeps its index.
    expect(moveRuleWithinSection(order, "b", 1)).toEqual([
      "x",
      "a",
      "y",
      "c",
      "z",
      "b",
    ]);
  });

  it("refuses to move past the end of its own section", () => {
    // `a` is last among Entry rules even though two links follow it.
    const order = links("b:entry", "a:entry", "z:exit", "y:context");
    expect(moveRuleWithinSection(order, "a", 1)).toBeNull();
  });

  it("refuses to move above the start of its own section", () => {
    // `a` is first among Entry rules even though a rule of another section precedes it.
    const order = links("x:context", "a:entry", "b:entry");
    expect(moveRuleWithinSection(order, "a", -1)).toBeNull();
  });

  it("returns null for a lone rule in its section, in both directions", () => {
    const order = links("x:context", "solo:no_trade", "y:context");
    expect(moveRuleWithinSection(order, "solo", 1)).toBeNull();
    expect(moveRuleWithinSection(order, "solo", -1)).toBeNull();
  });

  it("returns null for a rule that is not linked at all", () => {
    expect(moveRuleWithinSection(links("a:entry"), "ghost", 1)).toBeNull();
  });

  it("returns null for an empty playbook", () => {
    expect(moveRuleWithinSection([], "a", 1)).toBeNull();
  });

  it("never mutates the input", () => {
    const order = links("a:entry", "b:entry");
    const before = JSON.stringify(order);
    moveRuleWithinSection(order, "a", 1);
    expect(JSON.stringify(order)).toBe(before);
  });

  it("returns every link, so the caller can rewrite ordinals from it", () => {
    // The action numbers the result 0..n-1. A short array would silently drop
    // links off the end of the playbook.
    const order = links("a:entry", "b:context", "c:exit", "d:entry");
    const next = moveRuleWithinSection(order, "a", 1)!;
    expect(next).toHaveLength(order.length);
    expect([...next].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("moveInOrder", () => {
  const ids = ["a", "b", "c"];

  it("swaps with the neighbour in the given direction", () => {
    expect(moveInOrder(ids, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(ids, "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("returns the whole order, not just the pair that moved", () => {
    // The caller writes ordinals from indices. Handing back two positions would
    // leave a list that already holds duplicate `sort_order` values ambiguous;
    // handing back all of it normalises them on the way through.
    expect(moveInOrder(ids, "a", 1)).toHaveLength(3);
  });

  it("clamps at both ends instead of wrapping", () => {
    // Null, not a copy: it lets the action skip the write entirely, and it is
    // what disables the arrow rather than making it silently do nothing.
    expect(moveInOrder(ids, "a", -1)).toBeNull();
    expect(moveInOrder(ids, "c", 1)).toBeNull();
  });

  it("is null for an id that is not in the list", () => {
    expect(moveInOrder(ids, "zzz", 1)).toBeNull();
  });

  it("leaves the input untouched", () => {
    const original = [...ids];
    moveInOrder(ids, "b", 1);
    expect(ids).toEqual(original);
  });
});

describe("moveToIndex", () => {
  it("drops a row below the one it was dragged onto", () => {
    // The direction that is easy to get wrong. Dragging `a` onto `c` must put
    // `a` AFTER `c` — taking c's index before removing `a` would leave it at
    // index 1, one place short of where the pointer was released.
    expect(moveToIndex(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("drops a row above the one it was dragged onto, going up", () => {
    expect(moveToIndex(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("moves to the very front and the very back", () => {
    expect(moveToIndex(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveToIndex(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("returns null when nothing would move, so the caller can skip the write", () => {
    expect(moveToIndex(["a", "b", "c"], "a", "a")).toBeNull();
    expect(moveToIndex(["a", "b", "c"], "a", "zz")).toBeNull();
    expect(moveToIndex(["a", "b", "c"], "zz", "a")).toBeNull();
  });

  it("moving onto the neighbour below is a plain swap", () => {
    expect(moveToIndex(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
  });
});

describe("reorderWithinSection", () => {
  it("refills the section's own slots and leaves every other index alone", () => {
    // Entry occupies slots 1, 3, 5. Reversing Entry must not move `x`, `y` or
    // `z` off their indices — nothing on screen draws the flat order, and the
    // other sections' cards must not reshuffle because this one was dragged.
    const order = links(
      "x:context",
      "a:entry",
      "y:exit",
      "b:entry",
      "z:context",
      "c:entry",
    );
    expect(reorderWithinSection(order, "entry", ["c", "b", "a"])).toEqual([
      "x",
      "c",
      "y",
      "b",
      "z",
      "a",
    ]);
  });

  it("keeps a rule the client forgot to name, rather than dropping it", () => {
    // A stale client array is the realistic failure — a rule added in another
    // tab. It must keep its place in the section rather than vanish from the
    // playbook, so unnamed ids are appended in their current order.
    const order = links("a:entry", "b:entry", "c:entry");
    expect(reorderWithinSection(order, "entry", ["c", "a"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("ignores ids belonging to another section", () => {
    const order = links("a:entry", "b:context");
    expect(reorderWithinSection(order, "entry", ["b", "a"])).toBeNull();
  });

  it("returns null when the result matches what is already stored", () => {
    const order = links("a:entry", "b:entry");
    expect(reorderWithinSection(order, "entry", ["a", "b"])).toBeNull();
  });

  it("returns null for a section with no rules", () => {
    const order = links("a:entry");
    expect(reorderWithinSection(order, "exit", [])).toBeNull();
  });
});
