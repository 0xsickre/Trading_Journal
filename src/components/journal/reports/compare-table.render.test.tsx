import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompareTable } from "./compare-table";
import { compareReports, runReport } from "@/lib/journal/reports/engine";
import { dimCtx, enrich, metricCtx } from "@/lib/journal/reports/test-helpers";

const KEYS = ["win_rate", "net_pnl"];

const run = (trades: ReturnType<typeof enrich>) =>
  runReport({
    trades,
    dimension: "instrument",
    metricKeys: KEYS,
    dimensionContext: dimCtx(),
    metricContext: metricCtx,
  })!;

const spec = (prefix: string, wins: number, total: number, instrument = "XAUUSD") =>
  Array.from({ length: total }, (_, i) => ({
    id: `${prefix}${i}`,
    instrument,
    net: i < wins ? 100 : -100,
    r: i < wins ? 1 : -1,
  }));

const table = (
  a: ReturnType<typeof run>,
  b: ReturnType<typeof run>,
  onSort: (s: string) => void = vi.fn(),
) =>
  render(
    <CompareTable
      result={compareReports(a, b, metricCtx)}
      viewMode="dollars"
      currency="USD"
      equityBase={null}
      onSort={onSort}
      labels={{ a: "A", b: "B" }}
    />,
  );

describe("CompareTable", () => {
  it("shows both sides and the gap between them", () => {
    table(run(enrich(spec("a", 2, 10))), run(enrich(spec("b", 8, 10))));

    expect(screen.getByText("20.0%")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    // B − A, signed, as points rather than as a percentage of a percentage.
    expect(screen.getByText("+60.0%")).toBeInTheDocument();
    expect(screen.getByText("10 / 10")).toBeInTheDocument();
  });

  it("warns that the two sets share trades, because the interval assumes they do not", () => {
    const shared = enrich(spec("s", 5, 10));
    table(run(shared), run(shared));
    expect(screen.getByText(/10 trades are in both sets/)).toBeInTheDocument();
  });

  it("says nothing about a bucket only one set traded, rather than a fall to zero", () => {
    table(
      run(enrich(spec("a", 5, 10, "XAUUSD"))),
      run(enrich(spec("b", 5, 10, "EURUSD"))),
    );
    expect(screen.getByText(/never traded this group/)).toBeInTheDocument();
    // Two buckets, each with one side missing: four em dashes in the count
    // column and the metric cells, and no delta anywhere.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("names set A as what the cards above are about", () => {
    table(run(enrich(spec("a", 5, 10))), run(enrich(spec("b", 5, 10))));
    expect(screen.getByText(/describe set A/)).toBeInTheDocument();
  });

  it("sorts on a header click, better end first", async () => {
    const user = userEvent.setup({ delay: null });
    const onSort = vi.fn();
    table(run(enrich(spec("a", 5, 10))), run(enrich(spec("b", 5, 10))), onSort);

    await user.click(screen.getByRole("button", { name: /Win %/ }));
    expect(onSort).toHaveBeenLastCalledWith("win_rate:desc");
  });
});
