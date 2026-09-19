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
  it("dims a thin row but still shows its numbers, and says why once", () => {
    const result = run(
      enrich([
        ...Array.from({ length: 6 }, (_, i) => ({ id: `big${i}`, instrument: "EURUSD", net: 100 })),
        { id: "lonely", instrument: "XAUUSD", net: 900 },
      ]),
      "instrument",
    );
    table(result);
    expect(screen.getByText("XAUUSD").closest("tr")!.className).toContain("text-muted-foreground");
    expect(screen.getByText("EURUSD").closest("tr")!.className).not.toContain("text-muted-foreground");
    expect(screen.getByText("$900.00")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`fewer than ${DEFAULT_MIN_SAMPLE} trades`))).toBeInTheDocument();
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
