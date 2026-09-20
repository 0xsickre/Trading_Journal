import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportTable } from "./report-table";
import { runReport, DEFAULT_MIN_SAMPLE } from "@/lib/journal/reports/engine";
import { DEFAULT_METRIC_KEYS } from "@/lib/journal/reports/metrics";
import { dimCtx, enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

const run = (trades: ReturnType<typeof enrich>, dimension: string, sortBy?: string) =>
  runReport({
    trades,
    dimension,
    metricKeys: DEFAULT_METRIC_KEYS,
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
    sortBy,
  })!;

const table = (
  result: ReturnType<typeof run>,
  extra: { totals?: Record<string, number | null> | null; sortBy?: string; onSort?: (s: string) => void } = {},
) =>
  render(
    <ReportTable
      result={result}
      totals={extra.totals ?? null}
      viewMode="dollars"
      currency="USD"
      equityBase={null}
      sortBy={extra.sortBy}
      onSort={extra.onSort ?? vi.fn()}
    />,
  );

describe("ReportTable", () => {
  it("shows a thin row's numbers, and says it will not be ranked", () => {
    const result = run(
      enrich([
        ...Array.from({ length: 6 }, (_, i) => ({ id: `big${i}`, instrument: "EURUSD", net: 100 })),
        { id: "lonely", instrument: "XAUUSD", net: 900 },
      ]),
      "instrument",
    );
    table(result);
    // The row is no longer dimmed for being small — the interval under each
    // figure is what now says how much it can be trusted.
    expect(screen.getByText("$900.00")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Under ${DEFAULT_MIN_SAMPLE} trades`)),
    ).toBeInTheDocument();
  });

  it("a header click sorts better-first, and a second click on it reverses", async () => {
    const user = userEvent.setup({ delay: null });
    const onSort = vi.fn();
    const result = run(enrich([{ instrument: "EURUSD", net: 100 }]), "instrument");
    const { rerender } = table(result, { onSort });

    await user.click(screen.getByRole("button", { name: /Win %/ }));
    expect(onSort).toHaveBeenLastCalledWith("win_rate:desc");

    rerender(
      <ReportTable
        result={result}
        totals={null}
        viewMode="dollars"
        currency="USD"
        equityBase={null}
        sortBy="win_rate:desc"
        onSort={onSort}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Win %/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: /Win %/ }));
    expect(onSort).toHaveBeenLastCalledWith("win_rate:asc");
  });

  it("shows a Total row when it is handed one", () => {
    const result = run(
      enrich([
        { instrument: "EURUSD", net: 100 },
        { instrument: "XAUUSD", net: -40 },
      ]),
      "instrument",
    );
    table(result, { totals: { net_pnl: 60 } });
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getByText("$60.00")).toBeInTheDocument();
    expect(within(total).getByText("2")).toBeInTheDocument();
  });

  it("names a trade with no value '(none)', and warns that tag rows overlap", () => {
    const result = run(
      enrich([
        { technicalTags: ["FVG", "Sweep"], net: 100 },
        { technicalTags: [], net: -40 },
      ]),
      "technical_tags",
    );
    table(result);
    expect(screen.getByText("(none)")).toBeInTheDocument();
    expect(screen.getByText(/rows do not add up to the book/)).toBeInTheDocument();
  });
});

describe("the confidence intervals", () => {
  /** Four winners and four losers: a book that has established nothing. */
  const coinFlip = () =>
    enrich([
      ...Array.from({ length: 4 }, (_, i) => ({ id: `w${i}`, instrument: "EURUSD", net: 100, r: 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `l${i}`, instrument: "EURUSD", net: -100, r: -1 })),
    ]);

  it("prints a range under the figures that carry one, and nothing under the rest", () => {
    const result = run(coinFlip(), "instrument");
    table(result);
    const row = screen.getByText("EURUSD").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    const byMetric = new Map(result.metrics.map((m, i) => [m.key, cells[i + 2]]));

    // A win rate of 50 % over eight decided trades cannot rule out a coin.
    expect(byMetric.get("win_rate")!.textContent).toMatch(/\d+\.\d% – \d+\.\d%/);
    expect(byMetric.get("expectancy")!.textContent).toMatch(/R – /);
    // Trades and net P&L are counts and sums: they are exactly what they say.
    expect(byMetric.get("net_pnl")!.textContent).not.toMatch(/–/);
  });

  it("dims the figure whose interval still contains no edge", () => {
    const result = run(coinFlip(), "instrument");
    table(result);
    const row = screen.getByText("EURUSD").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    const winRateCell = cells[result.metrics.findIndex((m) => m.key === "win_rate") + 2];
    expect(winRateCell.className).toContain("text-muted-foreground");
    expect(screen.getByText(/interval still includes no edge/)).toBeInTheDocument();
  });

  it("masks both bounds in privacy mode, exactly as it masks the figure", () => {
    const result = run(coinFlip(), "instrument");
    render(
      <ReportTable
        result={result}
        totals={null}
        viewMode="privacy"
        currency="USD"
        equityBase={null}
        onSort={vi.fn()}
      />,
    );
    const row = screen.getByText("EURUSD").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    const winRateCell = cells[result.metrics.findIndex((m) => m.key === "win_rate") + 2];
    expect(winRateCell.textContent).not.toMatch(/\d/);
    expect(winRateCell.textContent).toContain("•••");
  });
});
