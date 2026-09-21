import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissedPanel } from "./missed-panel";
import { missedCost } from "@/lib/journal/missed-cost";
import type { TradeRow } from "@/lib/journal/types";

const row = (over: Record<string, unknown> = {}): TradeRow =>
  ({
    id: "m1",
    trade_no: 1,
    instrument: "XAUUSD",
    status: "missed",
    created_at: "2026-03-02T09:00:00Z",
    miss_reason: "Oklevanje",
    missed_outcome: "target",
    missed_r: 3,
    stats: null,
    ...over,
  }) as unknown as TradeRow;

const panel = (rows: TradeRow[], stalePlans = 0) =>
  render(<MissedPanel cost={missedCost(rows)} stalePlans={stalePlans} />);

describe("MissedPanel", () => {
  it("prices the misses and says how many would have worked", () => {
    panel([row(), row({ id: "m2", missed_outcome: "stop", missed_r: -1 })]);
    expect(screen.getByText("2 missed")).toBeInTheDocument();
    // The total, and the same figure again under the one reason they share.
    expect(screen.getAllByText(/\+2\.00R/)).toHaveLength(2);
    expect(screen.getByText(/1 of 2 measured would have reached target/)).toBeInTheDocument();
  });

  it("shows an em dash, not a zero, when nothing has been measured", () => {
    panel([row({ missed_outcome: null, missed_r: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/mt5_excursion\.py --missed/)).toBeInTheDocument();
  });

  it("warns that unresolved plans make the figure measure filing, not hesitation", () => {
    panel([row()], 3);
    expect(screen.getByText(/3 plans are still unresolved/)).toBeInTheDocument();
  });

  it("says the report's dates do not bound it", () => {
    panel([row()]);
    expect(screen.getByText(/cannot bound it/)).toBeInTheDocument();
  });

  it("renders nothing at all for a book with no misses and no stale plans", () => {
    const { container } = panel([]);
    expect(container).toBeEmptyDOMElement();
  });
});
