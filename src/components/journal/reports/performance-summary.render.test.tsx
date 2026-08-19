import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformanceSummaryPanel } from "./performance-summary";
import { runReport, summarizeReport, DEFAULT_MIN_SAMPLE } from "@/lib/journal/reports/engine";
import { DEFAULT_METRIC_KEYS, getMetric } from "@/lib/journal/reports/metrics";
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

describe("PerformanceSummaryPanel — W3: the win-rate tile respects privacy mode too", () => {
  // 5 trades per instrument — at or above `DEFAULT_MIN_SAMPLE`, or every
  // category is thin and `qualifying` is 0 before any of this is reachable.
  const book = enrich([
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, instrument: "EURUSD", net: 100, r: 1 })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, instrument: "XAUUSD", net: -50, r: -1 })),
  ]);

  it("dollars mode: the highest win-rate tile shows the real percentage", () => {
    const result = run(book);
    const summary = summarizeReport(result, "net_pnl");
    render(
      <PerformanceSummaryPanel
        summary={summary}
        metric={NET_PNL}
        viewMode="dollars"
        currency="USD"
        equityBase={null}
        minSample={DEFAULT_MIN_SAMPLE}
      />,
    );
    expect(screen.getByText("100.0%")).toBeInTheDocument(); // EURUSD: 2/2 wins
  });

  it("privacy mode: every tile masks, including 'Highest win rate' — the bug this fix closed", () => {
    const result = run(book);
    const summary = summarizeReport(result, "net_pnl");
    render(
      <PerformanceSummaryPanel
        summary={summary}
        metric={NET_PNL}
        viewMode="privacy"
        currency="USD"
        equityBase={null}
        minSample={DEFAULT_MIN_SAMPLE}
      />,
    );
    // Before the fix this tile bypassed `formatMetric` with a raw
    // `.toFixed(1)` and leaked "100.0%" even in privacy mode.
    expect(screen.queryByText("100.0%")).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("nothing qualifying (every category below minSample) shows the explicit sentence, not a guess", () => {
    const thin = enrich([{ instrument: "EURUSD", net: 100 }]);
    const result = run(thin);
    const summary = summarizeReport(result, "net_pnl");
    render(
      <PerformanceSummaryPanel
        summary={summary}
        metric={NET_PNL}
        viewMode="dollars"
        currency="USD"
        equityBase={null}
        minSample={DEFAULT_MIN_SAMPLE}
      />,
    );
    expect(screen.getByText(new RegExp(`at least ${DEFAULT_MIN_SAMPLE} trades`))).toBeInTheDocument();
  });

  it("ONE qualifying category is not crowned both best AND worst", () => {
    // `summarizeReport` sorts a list of one, so `best` and `worst` come back as
    // the SAME row — and the four tiles would then state, of a single bucket,
    // that it is the best, the worst, the most active and the highest win rate.
    // Every claim derivable, none informative.
    const lopsided = enrich([
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, instrument: "EURUSD", net: 100, r: 1 })),
      { id: "b0", instrument: "XAUUSD", net: -50, r: -1 },
    ]);
    const result = run(lopsided);
    const summary = summarizeReport(result, "net_pnl");
    expect(summary.qualifying).toBe(1);
    // The engine still reports both — the refusal is a presentation decision,
    // and this pins that the panel is the layer making it.
    expect(summary.best).toBe(summary.worst);

    render(
      <PerformanceSummaryPanel
        summary={summary}
        metric={NET_PNL}
        viewMode="dollars"
        currency="USD"
        equityBase={null}
        minSample={DEFAULT_MIN_SAMPLE}
      />,
    );

    expect(screen.queryByText(/^Best —/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Worst —/)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing to\s+rank it against/)).toBeInTheDocument();
    // The one category is still named, so the panel is not simply blank.
    expect(screen.getByText(/EURUSD/)).toBeInTheDocument();
  });
});
