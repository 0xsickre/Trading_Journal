import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioPanel } from "./scenario-panel";
import { resolveDimension } from "@/lib/journal/reports/dimensions";
import { dimCtx, enrich, scenarioDoc } from "@/lib/journal/reports/test-helpers";

const ctx = dimCtx();
const dim = (key: string) => resolveDimension(key, ctx)!;

describe("ScenarioPanel", () => {
  it("shows the grid over the measured trades, the best cell and the managed result beside it", () => {
    // One trade hit every target to 3R on the real stop; one was stopped everywhere.
    const trades = enrich([
      { r: 2, instrument: "MNQ", scenario: scenarioDoc({}, (i, j) => (i === 2 && [1, 1.5, 2, 2.5, 3][j] ? [1, 1.5, 2, 2.5, 3][j] : -1)) },
      { r: -1, instrument: "MNQ", scenario: scenarioDoc() },
    ]);
    render(<ScenarioPanel trades={trades} dimension={dim("instrument")} dimensionContext={ctx} />);
    expect(screen.getByText("SL × TP — what would have happened")).toBeInTheDocument();
    expect(screen.getByText(/under 30: a hypothesis/)).toBeInTheDocument();
    expect(screen.getByText("1× stop · 3R → +1.00R")).toBeInTheDocument();
    expect(screen.getAllByText(/your stop/).length).toBeGreaterThan(0);
    // Both stops saw the planned target come afterwards.
    expect(screen.getByText(/saw the target come after the stop/)).toBeInTheDocument();
  });

  it("counts a trade with a stop that is not measured yet, and renders nothing for a book without stops", () => {
    const { container, rerender } = render(
      <ScenarioPanel trades={enrich([{ r: 1 }])} dimension={dim("instrument")} dimensionContext={ctx} />,
    );
    expect(screen.getByText(/1 trade is not measured yet/)).toBeInTheDocument();
    rerender(<ScenarioPanel trades={[]} dimension={dim("instrument")} dimensionContext={ctx} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("groups by the report's dimension when there is more than one bucket", () => {
    const trades = enrich([
      { instrument: "MNQ", scenario: scenarioDoc() },
      { instrument: "MES", scenario: scenarioDoc() },
    ]);
    render(<ScenarioPanel trades={trades} dimension={dim("instrument")} dimensionContext={ctx} />);
    expect(screen.getByText(/By instrument/)).toBeInTheDocument();
    expect(screen.getByText("MES")).toBeInTheDocument();
  });
});
