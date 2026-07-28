import { describe, expect, it } from "vitest";
import { cellKey, getCell, runPivot } from "./pivot";
import { dimCtx, enrich, metricCtx } from "./test-helpers";

const run = (
  trades: ReturnType<typeof enrich>,
  rowDimension: string,
  colDimension: string,
  extra: Partial<Parameters<typeof runPivot>[0]> = {},
) =>
  runPivot({
    trades,
    rowDimension,
    colDimension,
    metricKey: "net_pnl",
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
    ...extra,
  });

describe("the question this exists for", () => {
  // "Does an A-setup with the macro bias beat one against it, and on what
  // sample?" A single-dimension table cannot separate the two.
  const book = enrich([
    { setupGrade: "A", macroAlign: "Uz bias", net: 300, r: 3 },
    { setupGrade: "A", macroAlign: "Uz bias", net: 200, r: 2 },
    { setupGrade: "A", macroAlign: "Protiv bias", net: -100, r: -1 },
    { setupGrade: "B", macroAlign: "Uz bias", net: 50, r: 0.5 },
  ]);

  it("splits one dimension by the other", () => {
    const p = run(book, "setup_grade", "macro_align")!;
    expect(getCell(p, "A", "Uz bias")?.value).toBe(500);
    expect(getCell(p, "A", "Protiv bias")?.value).toBe(-100);
    expect(getCell(p, "B", "Uz bias")?.value).toBe(50);
  });

  it("leaves untouched intersections absent rather than zero", () => {
    // A blank cell must not be readable as "zero P&L here".
    const p = run(book, "setup_grade", "macro_align")!;
    expect(getCell(p, "B", "Protiv bias")).toBeUndefined();
  });

  it("carries n on every cell", () => {
    const p = run(book, "setup_grade", "macro_align")!;
    expect(getCell(p, "A", "Uz bias")?.n).toBe(2);
    expect(getCell(p, "A", "Protiv bias")?.n).toBe(1);
  });
});

describe("sample marking", () => {
  it("marks thin cells but still computes them", () => {
    const p = run(
      enrich([
        { setupGrade: "A", macroAlign: "Uz bias", net: 100 },
        { setupGrade: "A", macroAlign: "Uz bias", net: 100 },
      ]),
      "setup_grade",
      "macro_align",
    )!;
    const cell = getCell(p, "A", "Uz bias")!;
    expect(cell.belowSample).toBe(true);
    expect(cell.value).toBe(200);
  });

  it("respects a custom threshold", () => {
    const p = run(
      enrich([{ setupGrade: "A", macroAlign: "Uz bias", net: 100 }]),
      "setup_grade",
      "macro_align",
      { minSample: 1 },
    )!;
    expect(getCell(p, "A", "Uz bias")!.belowSample).toBe(false);
  });
});

describe("totals", () => {
  const book = enrich([
    { setupGrade: "A", macroAlign: "Uz bias", net: 300 },
    { setupGrade: "A", macroAlign: "Protiv bias", net: -100 },
    { setupGrade: "B", macroAlign: "Uz bias", net: 50 },
  ]);

  it("computes row, column and grand totals", () => {
    const p = run(book, "setup_grade", "macro_align")!;
    expect(p.rowTotals.get("A")?.value).toBe(200);
    expect(p.colTotals.get("Uz bias")?.value).toBe(350);
    expect(p.grandTotal.value).toBe(250);
    expect(p.grandTotal.n).toBe(3);
  });
});

describe("keys and ordering", () => {
  it("orders an ordinal dimension by its declaration", () => {
    const p = run(
      enrich([
        { durationSeconds: 20 * 86_400, macroAlign: "Uz bias" },
        { durationSeconds: 3_600, macroAlign: "Uz bias" },
      ]),
      "hold_duration",
      "macro_align",
    )!;
    expect(p.rowKeys).toEqual(["<1d", ">2w"]);
  });

  it("orders a non-ordinal dimension busiest first", () => {
    const p = run(
      enrich([
        { instrument: "BUSY", macroAlign: "Uz bias" },
        { instrument: "BUSY", macroAlign: "Uz bias" },
        { instrument: "QUIET", macroAlign: "Uz bias" },
      ]),
      "instrument",
      "macro_align",
    )!;
    expect(p.rowKeys).toEqual(["BUSY", "QUIET"]);
  });

  it("keys cells unambiguously even when labels contain separators", () => {
    // "2R … 3R" and "4–5 (ispod proseka)" are real bucket labels; a delimiter
    // key would eventually split one of them in the wrong place.
    expect(cellKey("2R … 3R", "Uz bias")).not.toBe(
      cellKey("2R", "… 3R Uz bias"),
    );
    const p = run(
      enrich([{ r: 2.5, net: 250, macroAlign: "Uz bias" }]),
      "r_bucket",
      "macro_align",
    )!;
    expect(getCell(p, "2R … 3R", "Uz bias")?.value).toBe(250);
  });
});

describe("exclusions and edge cases", () => {
  it("drops a trade missing either dimension", () => {
    const p = run(
      enrich([
        { setupGrade: "A", macroAlign: "Uz bias", net: 100 },
        { setupGrade: "A", macroAlign: undefined, net: 999 },
      ]),
      "setup_grade",
      "macro_align",
    )!;
    // The second trade lands in the explicit "—" column, not silently nowhere.
    expect(p.colKeys).toContain("—");
    expect(p.grandTotal.n).toBe(2);
  });

  it("flags a multi-value axis", () => {
    const p = run(
      enrich([{ technicalTags: ["FVG", "Sweep"], macroAlign: "Uz bias" }]),
      "technical_tags",
      "macro_align",
    )!;
    expect(p.multiValue).toBe(true);
  });

  it("returns null for an unknown dimension or metric", () => {
    expect(run(enrich([{}]), "nope", "macro_align")).toBeNull();
    expect(
      run(enrich([{}]), "setup_grade", "macro_align", { metricKey: "nope" }),
    ).toBeNull();
  });

  it("handles an empty book", () => {
    const p = run(enrich([]), "setup_grade", "macro_align")!;
    expect(p.rowKeys).toEqual([]);
    expect(p.grandTotal.n).toBe(0);
  });
});
