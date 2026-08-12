import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DayStatsCard, type DayTradeRow } from "./day-stats-card";
import { computeStats } from "@/lib/journal/analytics";
import { computeCostStats } from "@/lib/journal/costs";
import { mkTrade } from "@/lib/journal/reports/test-helpers";

const trades = (rows: DayTradeRow[] = []) => rows;

/** The value shown under a `Figure` label — several tiles can legitimately
 *  read "—" on the same card (Win rate, Profit factor, R all guard
 *  independently), so a bare `getByText` is ambiguous by design. */
function figureValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

describe("DayStatsCard — the day's numbers, real stats through a real card", () => {
  it("a day with no closed trades says so, rather than showing a zeroed card", () => {
    render(
      <DayStatsCard
        stats={computeStats([])}
        costs={computeCostStats([])}
        volume={0}
        trades={[]}
        currency="USD"
      />,
    );
    expect(screen.getByText(/No trade closed on this day/)).toBeInTheDocument();
  });

  it("an all-breakeven day reads Win rate as '—', matching the guard already fixed on Dashboard (W1)", () => {
    const book = [
      mkTrade({ id: "b1", net: 0, closedAt: "2026-04-01T18:00:00Z" }),
      mkTrade({ id: "b2", net: 0, closedAt: "2026-04-01T19:00:00Z" }),
    ];
    render(
      <DayStatsCard
        stats={computeStats(book)}
        costs={computeCostStats(book)}
        volume={2}
        trades={trades()}
        currency="USD"
      />,
    );
    expect(figureValue("Win rate")).toBe("—");
  });

  it("profit factor renders as ∞ for all-winners, not a dash next to genuine 'no data'", () => {
    const book = [
      mkTrade({ id: "w1", net: 100, closedAt: "2026-04-01T18:00:00Z" }),
      mkTrade({ id: "w2", net: 50, closedAt: "2026-04-01T19:00:00Z" }),
    ];
    render(
      <DayStatsCard
        stats={computeStats(book)}
        costs={computeCostStats(book)}
        volume={2}
        trades={trades()}
        currency="USD"
      />,
    );
    expect(figureValue("Profit factor")).toBe("∞");
    expect(figureValue("Net P&L")).toBe("+$150.00");
  });

  it("closed trades listed under the toggle show each one's own R and net", () => {
    const book = [
      mkTrade({ id: "t1", net: 120, r: 1.2, closedAt: "2026-04-01T18:00:00Z" }),
    ];
    render(
      <DayStatsCard
        stats={computeStats(book)}
        costs={computeCostStats(book)}
        volume={1}
        trades={[{ id: "t1", label: "#1", symbol: "EURUSD", net: 120, r: 1.2, qty: 1 }]}
        currency="USD"
      />,
    );
    expect(screen.queryByText("EURUSD")).not.toBeInTheDocument(); // collapsed by default
    fireEvent.click(screen.getByRole("button", { name: /Show trades/ }));
    expect(screen.getByText("EURUSD")).toBeInTheDocument();
  });
});
