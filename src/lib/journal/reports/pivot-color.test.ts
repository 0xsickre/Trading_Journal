import { describe, expect, it } from "vitest";
import { pivotCellColor, pivotColorMode, pivotExtent } from "./pivot-color";
import type { PivotCell, PivotResult } from "./pivot";

function cell(value: number | null): PivotCell {
  return { row: "r", col: "c", n: 1, belowSample: false, value };
}

function resultWith(unit: PivotResult["metric"]["unit"], values: (number | null)[]): PivotResult {
  const cells = new Map<string, PivotCell>();
  values.forEach((v, i) => cells.set(String(i), cell(v)));
  return {
    metric: { unit } as PivotResult["metric"],
    cells,
  } as unknown as PivotResult;
}

describe("pivotColorMode", () => {
  it("treats count and seconds as pure magnitude — no bad direction", () => {
    expect(pivotColorMode("count")).toBe("sequential");
    expect(pivotColorMode("seconds")).toBe("sequential");
  });

  it("centers ratio metrics on 1, not 0", () => {
    expect(pivotColorMode("ratio")).toBe("diverging1");
  });

  it("centers everything else on 0", () => {
    expect(pivotColorMode("money")).toBe("diverging0");
    expect(pivotColorMode("r")).toBe("diverging0");
    expect(pivotColorMode("pct")).toBe("diverging0");
    expect(pivotColorMode("points")).toBe("diverging0");
  });
});

describe("pivotExtent", () => {
  it("answers 1 for an empty or all-anchor pivot, never 0", () => {
    expect(pivotExtent(resultWith("money", []))).toBe(1);
    expect(pivotExtent(resultWith("money", [0, 0]))).toBe(1);
  });

  it("finds the largest deviation from 0 for a diverging0 metric", () => {
    expect(pivotExtent(resultWith("money", [100, -300, 50]))).toBe(300);
  });

  it("finds the largest deviation from 1 for a diverging1 metric", () => {
    expect(pivotExtent(resultWith("ratio", [1.2, 0.4, 2.5]))).toBe(1.5);
  });

  it("ignores null cells", () => {
    expect(pivotExtent(resultWith("money", [null, 40, null]))).toBe(40);
  });
});

describe("pivotCellColor", () => {
  it("is transparent for a missing cell — no trades, not a value", () => {
    expect(pivotCellColor(null, "money", 100)).toBe("transparent");
  });

  it("is the muted token exactly at the anchor", () => {
    expect(pivotCellColor(0, "money", 100)).toBe("var(--muted)");
    expect(pivotCellColor(1, "ratio", 100)).toBe("var(--muted)");
  });

  it("mixes profit/loss for a diverging0 metric by sign", () => {
    expect(pivotCellColor(50, "money", 100)).toContain("--profit");
    expect(pivotCellColor(-50, "money", 100)).toContain("--loss");
  });

  it("mixes profit/loss relative to 1 for a diverging1 metric", () => {
    expect(pivotCellColor(2, "ratio", 1)).toContain("--profit");
    expect(pivotCellColor(0.5, "ratio", 1)).toContain("--loss");
  });

  it("uses a single neutral tone for sequential metrics — no bad direction", () => {
    const c = pivotCellColor(30, "count", 100);
    expect(c).toContain("--chart-3");
    expect(c).not.toContain("--profit");
    expect(c).not.toContain("--loss");
  });
});
