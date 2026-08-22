import { describe, expect, it } from "vitest";
import {
  moveInOrder,
  moveRuleWithinCategory,
  moveToIndex,
  reorderWithinCategory,
  type RuleLink,
} from "./playbook-order";

/** Compact fixture: "a:entry" → { ruleId: "a", category: "entry" }. */
const links = (...spec: string[]): RuleLink[] =>
  spec.map((s) => {
    const [ruleId, category] = s.split(":");
    return { ruleId, category: category as RuleLink["category"] };
  });

describe("moveRuleWithinCategory", () => {
  it("swaps with the next rule of the same category", () => {
    const order = links("a:entry", "b:entry", "c:entry");
    expect(moveRuleWithinCategory(order, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("swaps with the previous one going up", () => {
    const order = links("a:entry", "b:entry", "c:entry");
    expect(moveRuleWithinCategory(order, "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("steps over a rule of another category, leaving it exactly where it was", () => {
    // The case this function exists for. `b` is a Context rule that happens to
    // sit between two Entry rules in the flat link order. Moving `a` down must
    // trade places with `c` — the next ENTRY rule — and `b` must not budge from
    // index 1, because nothing on screen draws the flat order.
    const order = links("a:entry", "b:context", "c:entry");
    expect(moveRuleWithinCategory(order, "a", 1)).toEqual(["c", "b", "a"]);
  });

  it("handles a category whose members are scattered through the order", () => {
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
    expect(moveRuleWithinCategory(order, "b", 1)).toEqual([
      "x",
      "a",
      "y",
      "c",
      "z",
      "b",
    ]);
  });

  it("refuses to move past the end of its own category", () => {
    // `a` is last among Entry rules even though two links follow it.
    const order = links("b:entry", "a:entry", "z:exit", "y:context");
    expect(moveRuleWithinCategory(order, "a", 1)).toBeNull();
  });

  it("refuses to move above the start of its own category", () => {
    // `a` is first among Entry rules even though a Context rule precedes it.
    const order = links("x:context", "a:entry", "b:entry");
    expect(moveRuleWithinCategory(order, "a", -1)).toBeNull();
  });

  it("returns null for a lone rule in its category, in both directions", () => {
    const order = links("x:context", "solo:no_trade", "y:context");
    expect(moveRuleWithinCategory(order, "solo", 1)).toBeNull();
    expect(moveRuleWithinCategory(order, "solo", -1)).toBeNull();
  });

  it("returns null for a rule that is not linked at all", () => {
    expect(moveRuleWithinCategory(links("a:entry"), "ghost", 1)).toBeNull();
  });

  it("returns null for an empty playbook", () => {
    expect(moveRuleWithinCategory([], "a", 1)).toBeNull();
  });

  it("never mutates the input", () => {
    const order = links("a:entry", "b:entry");
    const before = JSON.stringify(order);
    moveRuleWithinCategory(order, "a", 1);
    expect(JSON.stringify(order)).toBe(before);
  });

  it("returns every link, so the caller can rewrite ordinals from it", () => {
    // The action numbers the result 0..n-1. A short array would silently drop
    // links off the end of the playbook.
    const order = links("a:entry", "b:context", "c:exit", "d:entry");
    const next = moveRuleWithinCategory(order, "a", 1)!;
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

describe("reorderWithinCategory", () => {
  it("refills the category's own slots and leaves every other index alone", () => {
    // Entry occupies slots 1, 3, 5. Reversing Entry must not move `x`, `y` or
    // `z` off their indices — nothing on screen draws the flat order, and the
    // other categories' cards must not reshuffle because this one was dragged.
    const order = links(
      "x:context",
      "a:entry",
      "y:exit",
      "b:entry",
      "z:context",
      "c:entry",
    );
    expect(reorderWithinCategory(order, "entry", ["c", "b", "a"])).toEqual([
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
    // tab. It must keep its place in the category rather than vanish from the
    // playbook, so unnamed ids are appended in their current order.
    const order = links("a:entry", "b:entry", "c:entry");
    expect(reorderWithinCategory(order, "entry", ["c", "a"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("ignores ids belonging to another category", () => {
    const order = links("a:entry", "b:context");
    expect(reorderWithinCategory(order, "entry", ["b", "a"])).toBeNull();
  });

  it("returns null when the result matches what is already stored", () => {
    const order = links("a:entry", "b:entry");
    expect(reorderWithinCategory(order, "entry", ["a", "b"])).toBeNull();
  });

  it("returns null for a category with no rules", () => {
    const order = links("a:entry");
    expect(reorderWithinCategory(order, "exit", [])).toBeNull();
  });
});
