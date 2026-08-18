import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookOverviewPanel } from "./book-overview";
import { enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

/**
 * The panel that answers "how is the account doing" rather than "which bucket
 * wins" — the question `/reports` never had a home for.
 *
 * Two things are worth holding here. That it states the whole book undivided,
 * and that it does not leak a number in privacy mode. The second is not
 * hypothetical: `performance-summary.tsx` one file over carries a fixed bug
 * where a raw `.toFixed(1)` masked every tile except the win rate, and this
 * panel is newer and has eleven more chances to repeat it.
 */

const BOOK = enrich([
  { id: "w", net: 300, gross: 320, r: 3, plannedRr: "2", fees: 20 },
  { id: "l", net: -100, gross: -90, r: -1, plannedRr: "3", fees: 10, swap: 5 },
  { id: "b", net: 5, gross: 8, r: 0.05, plannedRr: "1", fees: 3 },
]);

const panel = (viewMode: "dollars" | "privacy", trades = BOOK) =>
  render(
    <BookOverviewPanel
      trades={trades}
      metricContext={metricCtx}
      viewMode={viewMode}
      currency="USD"
      equityBase={null}
    />,
  );

describe("BookOverviewPanel", () => {
  it("groups the figures by how they go quiet", () => {
    // The risk ratios fall silent without enough trading days; the execution
    // figures fall silent without a plan recorded on the trade. A reader
    // looking at five dashes wants to know which of those happened.
    panel("dollars");
    expect(screen.getByText("Risk-adjusted")).toBeInTheDocument();
    expect(screen.getByText("Execution")).toBeInTheDocument();
  });

  it("carries the sample, and says the book is undivided", () => {
    panel("dollars");
    expect(screen.getByText(/3 closed trades in scope/)).toBeInTheDocument();
    expect(screen.getByText(/not split by any dimension/)).toBeInTheDocument();
  });

  it("shows the execution figures the dashboard used to carry", () => {
    panel("dollars");
    for (const label of [
      "Avg entry slip",
      "Total slip R",
      "Target attainment",
      "Winner target attainment",
      "Avg hold",
      "Swap",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows the risk-adjusted figures the dashboard used to carry", () => {
    panel("dollars");
    for (const label of [
      "Sharpe",
      "Sortino",
      "Calmar",
      "Recovery factor",
      "Consistency",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("PRIVACY MODE MASKS EVERY MONETARY FIGURE", () => {
    // Money, R and percentages are masked; ratios, counts and durations are
    // NOT, and that is `formatMetric`'s deliberate line rather than an
    // oversight here — "hiding a trade count behind privacy mode would be
    // theatre, not privacy". A Sharpe of 2.05 says nothing about account size.
    //
    // So the assertion follows that contract instead of banning digits
    // outright: every metric this panel renders in a monetary unit must come
    // out masked. Written against the UNIT rather than a hand-listed set of
    // labels, so a twelfth metric added later is covered the day it lands.
    panel("privacy");
    const masked = screen.getAllByText("•••");
    // avg_entry_slip + total_slip_r (r), target_attainment +
    // winner_target_attainment (pct), total_swap (money).
    expect(masked).toHaveLength(5);
  });

  it("still masks when the figures would otherwise be large", () => {
    // The failure mode worth guarding: a value formatted by hand somewhere in
    // this panel would sail past the mask. Swap is the money one, so it is the
    // canary — it must never render its own digits.
    const rich = enrich([
      { id: "x", net: 10_000, gross: 10_500, r: 5, swap: 250, plannedRr: "2" },
    ]);
    panel("privacy", rich);
    expect(screen.queryByText(/250/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10,000/)).not.toBeInTheDocument();
  });

  it("renders on an empty book instead of throwing", () => {
    // Every metric answers null here, which is the correct reading of "no
    // trades in scope" and the state a filter combination reaches most often.
    panel("dollars", enrich([]));
    expect(screen.getByText(/0 closed trades in scope/)).toBeInTheDocument();
  });
});
