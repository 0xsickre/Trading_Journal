import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportTable } from "./report-table";
import { runReport, DEFAULT_MIN_SAMPLE } from "@/lib/journal/reports/engine";
import { DEFAULT_METRIC_KEYS } from "@/lib/journal/reports/metrics";
import { dimCtx, enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

const run = (trades: ReturnType<typeof enrich>, dimension: string) =>
  runReport({
    trades,
    dimension,
    metricKeys: DEFAULT_METRIC_KEYS,
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
  })!;

/**
 * Real `runReport` output, rendered — the same "papir → lib → ekran" bridge
 * step 1 used for the Dashboard, applied to the reports table.
 */
describe("ReportTable — real report engine output, on screen", () => {
  it("empty result shows the no-data sentence, not a blank table", () => {
    const result = run(enrich([]), "instrument");
    render(
      <ReportTable result={result} viewMode="dollars" currency="USD" equityBase={null} onSort={vi.fn()} />,
    );
    expect(screen.getByText(/Nema trejdova za izabrane filtere/)).toBeInTheDocument();
  });

  it("a thin row is dimmed and carries the sample-size warning, but its numbers still show", () => {
    const trades = enrich([
      ...Array.from({ length: 6 }, (_, i) => ({ id: `big${i}`, instrument: "EURUSD", net: 100 })),
      { id: "lonely", instrument: "XAUUSD", net: 900 },
    ]);
    const result = run(trades, "instrument");
    render(
      <ReportTable result={result} viewMode="dollars" currency="USD" equityBase={null} onSort={vi.fn()} />,
    );

    const thinRow = screen.getByText("XAUUSD").closest("tr")!;
    expect(thinRow.className).toContain("opacity-45");
    expect(thinRow).toHaveAttribute(
      "title",
      expect.stringContaining(`ispod praga od ${DEFAULT_MIN_SAMPLE}`),
    );
    expect(screen.getByText("$900.00")).toBeInTheDocument(); // shown, not hidden

    const bigRow = screen.getByText("EURUSD").closest("tr")!;
    expect(bigRow.className).not.toContain("opacity-45");
  });

  it("clicking a metric header calls onSort with that metric's key", async () => {
    const user = userEvent.setup({ delay: null });
    const onSort = vi.fn();
    const result = run(enrich([{ instrument: "EURUSD", net: 100 }]), "instrument");
    render(<ReportTable result={result} viewMode="dollars" currency="USD" equityBase={null} onSort={onSort} />);

    await user.click(screen.getByRole("button", { name: /Win %/ }));
    expect(onSort).toHaveBeenCalledWith("win_rate");
  });
});
