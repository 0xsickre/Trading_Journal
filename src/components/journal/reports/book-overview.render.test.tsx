import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookOverviewPanel } from "./book-overview";
import { enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

/**
 * The whole book before any split: how the account is doing, not which group
 * wins. Held here: that it counts the book, and that Privacy hides every
 * monetary figure — the neighbouring summary panel once leaked a win rate
 * through a hand-formatted number.
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
  it("leads with the trade count and the headline figures", () => {
    panel("dollars");
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    for (const label of ["Net P&L", "Win %", "Profit factor", "Expectancy", "Max drawdown"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("$205.00")).toBeInTheDocument();
  });

  it("keeps the risk and execution figures in a quieter second row", () => {
    panel("dollars");
    for (const label of [
      "Total R",
      "Avg risk taken",
      "Risk dispersion",
      "Follow rate",
      "Target attainment",
      "Avg entry slip",
      "Avg hold",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("no longer offers the annualised ratios this book cannot support", () => {
    // Forty to seventy trades a year, with periods-per-year measured from the
    // data: three numbers incomparable with any published figure. Still in the
    // registry as optional columns — just not in the reader's face.
    panel("dollars");
    for (const label of ["Sharpe", "Sortino", "Calmar", "Recovery factor"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("privacy masks every monetary, R and % figure", () => {
    // Counts and durations stay: "3 trades" says nothing about account size.
    panel("privacy");
    // net_pnl, win_rate, expectancy, max_drawdown, total_r, avg_risk_pct,
    // risk_dispersion, follow_rate, target_attainment, avg_entry_slip.
    expect(screen.getAllByText("•••").length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText("$205.00")).not.toBeInTheDocument();
  });

  it("renders on an empty book instead of throwing", () => {
    panel("dollars", enrich([]));
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
