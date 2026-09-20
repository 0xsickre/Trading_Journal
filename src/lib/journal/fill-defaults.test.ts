import { describe, expect, it } from "vitest";
import {
  plannedSize,
  qtyToInput,
  seedFillQty,
  sizeDeviationNote,
} from "./fill-defaults";

describe("qtyToInput", () => {
  it("keeps a plain size as it reads on screen", () => {
    expect(qtyToInput(4.78)).toBe("4.78");
  });

  it("removes float dust rather than showing seventeen digits", () => {
    // 4.78 − 2 in binary floating point.
    expect(qtyToInput(4.78 - 2)).toBe("2.78");
    expect(qtyToInput(0.1 + 0.2)).toBe("0.3");
  });

  it("does not invent decimals on a whole number", () => {
    expect(qtyToInput(3)).toBe("3");
  });

  it("empty for a number that is not one", () => {
    expect(qtyToInput(Number.NaN)).toBe("");
    expect(qtyToInput(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("plannedSize", () => {
  it("the stored field wins over the live suggestion", () => {
    expect(plannedSize(4.78, 9.99)).toBe(4.78);
  });

  it("a numeric string from the form is read as a number", () => {
    expect(plannedSize("4.78", null)).toBe(4.78);
  });

  it("falls back to the suggestion while the field is empty", () => {
    expect(plannedSize("", 4.78)).toBe(4.78);
    expect(plannedSize(null, 4.78)).toBe(4.78);
  });

  it("null when neither can size the trade", () => {
    // The case that matters: no instrument spec, so `computePositionSize`
    // refused. A 1 here would be the guess that refusal exists to prevent.
    expect(plannedSize(null, null)).toBeNull();
    expect(plannedSize("", null)).toBeNull();
  });

  it("zero and nonsense are not sizes", () => {
    expect(plannedSize(0, null)).toBeNull();
    expect(plannedSize(-2, null)).toBeNull();
    expect(plannedSize("abc", null)).toBeNull();
    expect(plannedSize(4.78, null)).toBe(4.78);
    expect(plannedSize(0, 4.78)).toBe(4.78);
  });
});

describe("seedFillQty", () => {
  it("the first entry opens with the planned size", () => {
    expect(
      seedFillQty({ side: "entry", plannedSize: 4.78, entryQty: 0, exitQty: 0 }),
    ).toBe("4.78");
  });

  it("a second entry offers only what is left of the plan", () => {
    expect(
      seedFillQty({ side: "entry", plannedSize: 4.78, entryQty: 2, exitQty: 0 }),
    ).toBe("2.78");
  });

  it("an entry that completes the plan offers nothing", () => {
    expect(
      seedFillQty({ side: "entry", plannedSize: 4.78, entryQty: 4.78, exitQty: 0 }),
    ).toBe("");
    expect(
      seedFillQty({ side: "entry", plannedSize: 4.78, entryQty: 6, exitQty: 0 }),
    ).toBe("");
  });

  it("no plan, no suggestion — never the old literal 1", () => {
    expect(
      seedFillQty({ side: "entry", plannedSize: null, entryQty: 0, exitQty: 0 }),
    ).toBe("");
  });

  it("an exit opens with everything still open", () => {
    expect(
      seedFillQty({ side: "exit", plannedSize: 4.78, entryQty: 4.78, exitQty: 0 }),
    ).toBe("4.78");
  });

  it("a second exit offers only the remainder", () => {
    expect(
      seedFillQty({ side: "exit", plannedSize: 4.78, entryQty: 4.78, exitQty: 3 }),
    ).toBe("1.78");
  });

  it("an exit never proposes closing more than was opened", () => {
    // A fully closed position, and an over-exited one, both offer nothing.
    expect(
      seedFillQty({ side: "exit", plannedSize: 4.78, entryQty: 4.78, exitQty: 4.78 }),
    ).toBe("");
    expect(
      seedFillQty({ side: "exit", plannedSize: 4.78, entryQty: 2, exitQty: 5 }),
    ).toBe("");
  });

  it("an exit ignores the plan and follows the fills", () => {
    // The import replaced a planned 4.78 with a 1-lot statement: what is open
    // is 1, not 4.78.
    expect(
      seedFillQty({ side: "exit", plannedSize: 4.78, entryQty: 1, exitQty: 0 }),
    ).toBe("1");
    expect(
      seedFillQty({ side: "exit", plannedSize: null, entryQty: 1, exitQty: 0 }),
    ).toBe("1");
  });

  it("float dust is not a remainder", () => {
    // 0.1 + 0.2 entered, 0.3 exited: nothing is open.
    expect(
      seedFillQty({ side: "exit", plannedSize: null, entryQty: 0.1 + 0.2, exitQty: 0.3 }),
    ).toBe("");
  });
});

describe("sizeDeviationNote", () => {
  it("names both sizes when the fill differs from the plan", () => {
    expect(
      sizeDeviationNote({ plannedSize: 4.78, entryQty: 1, unit: "lots" }),
    ).toBe("Filled 1.00 of a planned 4.78 lots.");
  });

  it("silent when the fill matches the plan as printed", () => {
    expect(
      sizeDeviationNote({ plannedSize: 4.78, entryQty: 4.78, unit: "lots" }),
    ).toBeNull();
    // The plan is shown to two decimals; a difference below that is not one.
    expect(
      sizeDeviationNote({ plannedSize: 4.7812, entryQty: 4.78, unit: "lots" }),
    ).toBeNull();
  });

  it("silent when there is no plan, or nothing filled", () => {
    expect(
      sizeDeviationNote({ plannedSize: null, entryQty: 1, unit: "lots" }),
    ).toBeNull();
    expect(
      sizeDeviationNote({ plannedSize: 4.78, entryQty: 0, unit: "lots" }),
    ).toBeNull();
  });

  it("says it just as plainly when the fill is LARGER than planned", () => {
    expect(
      sizeDeviationNote({ plannedSize: 1, entryQty: 4.78, unit: "lots" }),
    ).toBe("Filled 4.78 of a planned 1.00 lots.");
  });
});
