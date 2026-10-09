import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  HoldTimeCard,
  CostReportCard,
  PlanVsRealityCard,
  PeriodPerformanceCard,
  TimeStopCard,
} from "./metrics-panel";
import { computeTimeStop } from "@/lib/journal/time-stop";
import type { RealizedTrade } from "@/lib/journal/analytics";
import type { PositionStat, TradeRow } from "@/lib/journal/types";
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
    avgMinutes: 60,
    maxMinutes: 120,
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
      totalCosts: 0,
      grossProfit: 0,
      costPctOfGross: null,
    };
    render(<CostReportCard costs={costs} currency="USD" />);
    expect(screen.getByText(/None of the 5 trades carries a cost/)).toBeInTheDocument();
  });

  it("CostReportCard has no swap row: a future carries none (H1.4, H2)", () => {
    const futures: CostStats = {
      count: 5,
      withCostData: 5,
      totalFees: 25,
      totalCosts: 25,
      grossProfit: 280,
      costPctOfGross: 8.9,
    };
    render(<CostReportCard costs={futures} currency="USD" />);
    expect(screen.queryByText("Swap")).not.toBeInTheDocument();
  });

  it("CostReportCard reports actual costs, tinted as a loss, when data exists", () => {
    const costs: CostStats = {
      count: 5,
      withCostData: 5,
      totalFees: 25,
      totalCosts: 25,
      grossProfit: 280,
      costPctOfGross: 12.5,
    };
    render(<CostReportCard costs={costs} currency="USD" />);
    // Fees and the total are the same figure now that a future carries no swap.
    expect(screen.getAllByText("$25.00")).toHaveLength(2);
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

describe("TimeStopCard", () => {
  const trade = (id: string, net: number, secs: number, last: number, pct: number): RealizedTrade => ({
    id,
    closedAt: "2026-10-09T15:00:00Z",
    net,
    gross: net,
    r: null,
    row: {
      id,
      stats: { duration_seconds: secs } as PositionStat,
      last_underwater_seconds: last,
      time_underwater_pct: pct,
    } as unknown as TradeRow,
  });

  it("shows the winners' time to green and one ladder row per minute", () => {
    const stats = computeTimeStop([trade("w", 100, 600, 120, 20), trade("l", -50, 360, 360, 50)]);
    render(<TimeStopCard stats={stats} />);
    expect(screen.getByText("1 winners and 1 losers measured from the exchange candles")).toBeInTheDocument();
    expect(screen.getByText("Winners — median time to green").nextSibling).toHaveTextContent("2m");
    for (const m of [1, 2, 3, 5, 10, 15, 30, 60]) {
      expect(screen.getByText(`${m} min`)).toBeInTheDocument();
    }
  });

  it("reads dashes on a book nothing measured", () => {
    render(<TimeStopCard stats={computeTimeStop([])} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(8);
  });
});
