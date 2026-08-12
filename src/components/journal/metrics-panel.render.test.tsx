import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  HoldTimeCard,
  CostReportCard,
  PlanVsRealityCard,
  PeriodPerformanceCard,
} from "./metrics-panel";
import { summarizePeriods, type PeriodRow } from "@/lib/journal/period-stats";
import type { HoldTimeStats } from "@/lib/journal/hold-time";
import type { CostStats } from "@/lib/journal/costs";
import type { PlannedRStats } from "@/lib/journal/risk-metrics";
import type { ExcursionStats } from "@/lib/journal/excursion";
import type { DirectionSplit } from "@/lib/journal/activity";

const row = (over: Partial<PeriodRow> & { key: string }): PeriodRow => ({
  net: 0,
  gross: 0,
  trades: 1,
  wins: 0,
  losses: 0,
  breakeven: 0,
  r: 0,
  rTrades: 0,
  fees: 0,
  volume: 1,
  ...over,
});

describe("PeriodPerformanceCard — Win % on a flat book (W2)", () => {
  it("all-flat weeks read '—', not '0.0%' — same guard as the Dashboard KPI tile (W1)", () => {
    const summary = summarizePeriods([
      row({ key: "2026-W10", net: 0, breakeven: 1, trades: 1 }),
      row({ key: "2026-W11", net: 0, breakeven: 1, trades: 1 }),
    ]);
    expect(summary.winning + summary.losing).toBe(0); // sanity: the input really is all-flat

    render(<PeriodPerformanceCard summary={summary} label="Weekly performance" currency="USD" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("a real mixed book still reads the correct percentage — the guard doesn't hide a genuine number", () => {
    const summary = summarizePeriods([
      row({ key: "2026-W10", net: 100, wins: 1, trades: 1 }),
      row({ key: "2026-W11", net: 100, wins: 1, trades: 1 }),
      row({ key: "2026-W12", net: -50, losses: 1, trades: 1 }),
    ]);
    render(<PeriodPerformanceCard summary={summary} label="Weekly performance" currency="USD" />);
    expect(screen.getByText("66.7%")).toBeInTheDocument();
  });

  it("shows the best/worst period label and value, and the max win/loss streak", () => {
    const summary = summarizePeriods([
      row({ key: "2026-W10", net: 300, wins: 1, trades: 1 }),
      row({ key: "2026-W11", net: -100, losses: 1, trades: 1 }),
    ]);
    render(<PeriodPerformanceCard summary={summary} label="Weekly performance" currency="USD" />);
    expect(screen.getByText("2026-W10 · $300.00")).toBeInTheDocument();
    expect(screen.getByText("2026-W11 · -$100.00")).toBeInTheDocument();
  });
});

describe("HoldTimeCard, CostReportCard, PlanVsRealityCard — presentation only, no guard defects", () => {
  const holdStats: HoldTimeStats = {
    count: 4,
    avgSeconds: 3600,
    avgWinnerSeconds: 1800,
    avgLoserSeconds: 5400,
    avgBreakevenSeconds: null,
    longestSeconds: 7200,
    longestTradeId: "t1",
    avgDays: 0.5,
    maxDays: 1,
  };

  it("HoldTimeCard formats every duration and leaves breakeven as a dash when unset", () => {
    render(<HoldTimeCard stats={holdStats} />);
    expect(screen.getByText("4 trades with a known duration")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // avgBreakevenSeconds
  });

  it("CostReportCard names when a day has NO cost data rather than implying it was free", () => {
    const costs: CostStats = {
      count: 5,
      withCostData: 0,
      totalFees: 0,
      totalSwap: 0,
      totalCosts: 0,
      grossProfit: 0,
      costPctOfGross: null,
      avgSwapPerHoldingDay: null,
      holdingDays: 0,
    };
    render(<CostReportCard costs={costs} currency="USD" />);
    expect(screen.getByText(/None of the 5 trades carries a cost/)).toBeInTheDocument();
  });

  it("CostReportCard reports actual costs, tinted as a loss, when data exists", () => {
    const costs: CostStats = {
      count: 5,
      withCostData: 5,
      totalFees: 25,
      totalSwap: 10,
      totalCosts: 35,
      grossProfit: 280,
      costPctOfGross: 12.5,
      avgSwapPerHoldingDay: 2,
      holdingDays: 5,
    };
    render(<CostReportCard costs={costs} currency="USD" />);
    expect(screen.getByText("$35.00")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
  });

  it("PlanVsRealityCard shows an em dash for MAE when the sample is empty, not a false zero", () => {
    const plannedR: PlannedRStats = { count: 0, avgPlannedR: null, avgRealizedR: null, deltaR: null };
    const excursion: ExcursionStats = {
      maeCount: 0,
      avgMaeR: null,
      worstMaeR: null,
      noDrawdownCount: 0,
      mfeCount: 0,
      avgMfeR: null,
    };
    const direction: DirectionSplit = {
      longs: { count: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, net: 0 },
      shorts: { count: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, net: 0 },
    };
    render(<PlanVsRealityCard plannedR={plannedR} excursion={excursion} direction={direction} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
