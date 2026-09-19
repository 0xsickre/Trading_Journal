import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformanceSummaryPanel } from "./performance-summary";
import { runReport, summarizeReport, DEFAULT_MIN_SAMPLE } from "@/lib/journal/reports/engine";
import { DEFAULT_METRIC_KEYS, getMetric } from "@/lib/journal/reports/metrics";
import { getDimension } from "@/lib/journal/reports/dimensions";
import { dimCtx, enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

const run = (trades: ReturnType<typeof enrich>) =>
  runReport({
    trades,
    dimension: "instrument",
    metricKeys: DEFAULT_METRIC_KEYS,
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
  })!;

const NET_PNL = getMetric("net_pnl")!;
const INSTRUMENT = getDimension("instrument")!;

const panel = (trades: ReturnType<typeof enrich>, viewMode: "dollars" | "privacy" = "dollars") =>
  render(
    <PerformanceSummaryPanel
      summary={summarizeReport(run(trades), "net_pnl")}
      dimension={INSTRUMENT}
      metric={NET_PNL}
      viewMode={viewMode}
      currency="USD"
      equityBase={null}
      minSample={DEFAULT_MIN_SAMPLE}
    />,
  );

describe("PerformanceSummaryPanel", () => {
  // 5 trades per instrument — at the threshold, so both qualify.
  const book = enrich([
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, instrument: "EURUSD", net: 100, r: 1 })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, instrument: "XAUUSD", net: -50, r: -1 })),
  ]);

  it("names the best, the worst and the most traded group on the ranking metric", () => {
    panel(book);
    expect(screen.getByText("Best net p&l")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("-$250.00")).toBeInTheDocument();
    expect(screen.getByText("Most traded")).toBeInTheDocument();
  });

  it("privacy hides the amounts", () => {
    panel(book, "privacy");
    expect(screen.queryByText("$500.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("•••")).toHaveLength(2);
  });

  it("with fewer than two groups at the threshold it ranks nothing, in one line", () => {
    // One qualifying group would be named best AND worst.
    const lopsided = enrich([
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, instrument: "EURUSD", net: 100, r: 1 })),
      { id: "b0", instrument: "XAUUSD", net: -50, r: -1 },
    ]);
    panel(lopsided);
    expect(screen.queryByText(/^Best/)).not.toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`two groups with ${DEFAULT_MIN_SAMPLE} or more trades`)),
    ).toBeInTheDocument();
  });
});
