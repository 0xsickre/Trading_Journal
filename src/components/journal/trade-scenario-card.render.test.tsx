import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeScenarioCard } from "./trade-scenario-card";
import { scenarioTrade } from "@/lib/journal/scenario";
import { scenarioDoc } from "@/lib/journal/reports/test-helpers";
import type { TradeRow } from "@/lib/journal/types";

const trade = (doc: Record<string, unknown>) =>
  scenarioTrade({
    id: "t",
    scenario: doc,
    stats: { entry_qty: 2, total_fees: 2.44, point_value: 2, fx_rate: 1, realized_r: -1, realized_r_net: -1.06 },
  } as unknown as TradeRow)!;

describe("TradeScenarioCard", () => {
  it("says what the stop was followed by, and the stop that would have lived to the target", () => {
    render(<TradeScenarioCard trade={trade(scenarioDoc())} />);
    expect(screen.getByText("The planned target came 40 min after the stop.")).toBeInTheDocument();
    expect(screen.getByText("1.30R (13.00 pts)")).toBeInTheDocument();
    // After the exit, 15 minutes: 12 points your way on a 10-point stop.
    expect(screen.getByText("+1.20R")).toBeInTheDocument();
  });

  it("tells a hand exit the old stop would have come first", () => {
    render(
      <TradeScenarioCard
        trade={trade(scenarioDoc({ exit_kind: "other", exit: 105, after_exit: { windows: {}, target_minutes: null, stop_first: true } }))}
      />,
    );
    expect(screen.getByText("Held on, the old stop would have come before the target.")).toBeInTheDocument();
  });

  it("measures how far a target exit ran on", () => {
    render(<TradeScenarioCard trade={trade(scenarioDoc({ exit_kind: "target", exit: 120 }))} />);
    expect(screen.getByText("After the target it went another 4.00R your way by 15:10 CT.")).toBeInTheDocument();
  });
});
