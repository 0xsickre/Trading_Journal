import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrossAnalysis } from "./cross-analysis";
import { runPivot } from "@/lib/journal/reports/pivot";
import { dimCtx, enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

const run = (trades: ReturnType<typeof enrich>, rowDimension: string, colDimension: string) =>
  runPivot({
    trades,
    rowDimension,
    colDimension,
    metricKey: "net_pnl",
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
  })!;

/** The first DOM match for a value — cells render before the row/grand total
 *  that can coincidentally share the same formatted text (a row with a
 *  single populated cell has a total equal to that cell). */
const firstMatch = (text: string) => screen.getAllByText(text)[0];

describe("CrossAnalysis — real pivot output, on screen", () => {
  it("an intersection with no trades is an em dash, not a zero", () => {
    const book = enrich([
      { setupGrade: "A", macroAlign: "Uz bias", net: 300 },
      { setupGrade: "B", macroAlign: "Protiv bias", net: -100 },
    ]);
    const result = run(book, "setup_grade", "macro_align");
    render(<CrossAnalysis result={result} viewMode="dollars" currency="USD" equityBase={null} />);

    // A/Protiv-bias and B/Uz-bias both have no trades — two absent cells.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(firstMatch("$300.00")).toBeInTheDocument();
    expect(firstMatch("-$100.00")).toBeInTheDocument();
  });

  it("thin cells are dimmed with their n visible, not hidden", () => {
    const book = enrich([
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`,
        setupGrade: "A",
        macroAlign: "Uz bias",
        net: 100,
      })),
      { id: "lonely", setupGrade: "B", macroAlign: "Uz bias", net: 900 },
    ]);
    const result = run(book, "setup_grade", "macro_align");
    render(<CrossAnalysis result={result} viewMode="dollars" currency="USD" equityBase={null} />);

    const thinCell = firstMatch("$900.00").closest("td")!;
    expect(thinCell.className).toContain("opacity-40");
    expect(thinCell).toHaveAttribute("title", expect.stringContaining("below the threshold"));

    const bigCell = firstMatch("$600.00").closest("td")!; // 6 × 100, the well-sampled cell
    expect(bigCell.className).not.toContain("opacity-40");
  });

  it("grand totals sit in their own row, labelled 'Total'", () => {
    const book = enrich([
      { setupGrade: "A", macroAlign: "Uz bias", net: 300 },
      { setupGrade: "A", macroAlign: "Protiv bias", net: 50 },
      { setupGrade: "B", macroAlign: "Uz bias", net: -100 },
      { setupGrade: "B", macroAlign: "Protiv bias", net: 20 },
    ]);
    const result = run(book, "setup_grade", "macro_align");
    render(<CrossAnalysis result={result} viewMode="dollars" currency="USD" equityBase={null} />);

    expect(screen.getAllByText("Total").length).toBeGreaterThan(0);
    // Grand total: 300 + 50 − 100 + 20 = 270, distinct from every cell/axis
    // total, so this can only be the one true grand-total figure.
    expect(screen.getByText("$270.00")).toBeInTheDocument();
  });

  it("colors cells by value — profit tint for the top, loss tint for the bottom", () => {
    const book = enrich([
      { setupGrade: "A", macroAlign: "Uz bias", net: 300 },
      { setupGrade: "A", macroAlign: "Protiv bias", net: 50 },
      { setupGrade: "B", macroAlign: "Uz bias", net: -100 },
      { setupGrade: "B", macroAlign: "Protiv bias", net: 20 },
    ]);
    const result = run(book, "setup_grade", "macro_align");
    render(<CrossAnalysis result={result} viewMode="dollars" currency="USD" equityBase={null} />);

    const bestCell = firstMatch("$300.00").closest("td")! as HTMLElement;
    expect(bestCell.style.backgroundColor).toContain("--profit");
    const worstCell = firstMatch("-$100.00").closest("td")! as HTMLElement;
    expect(worstCell.style.backgroundColor).toContain("--loss");
  });

  it("empty axes show the no-intersection sentence instead of an empty grid", () => {
    const result = run(enrich([]), "setup_grade", "macro_align");
    render(<CrossAnalysis result={result} viewMode="dollars" currency="USD" equityBase={null} />);
    expect(screen.getByText(/No trades carry a value for both dimensions/)).toBeInTheDocument();
  });
});
