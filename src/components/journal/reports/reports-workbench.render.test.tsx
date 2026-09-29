import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsWorkbench } from "./reports-workbench";
import { mkTrade, type TradeSpec } from "@/lib/journal/reports/test-helpers";
import type { Account, TradeRow } from "@/lib/journal/types";

/**
 * The Reports page as a whole: which book it opens on, what it says when there
 * is nothing to show, and that every control writes the URL instead of going
 * to the server. The engine and the panels have their own tests; this holds
 * the wiring between them.
 */

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

// The chart is recharts behind `next/dynamic`; its own test covers it. Here it
// only has to say which metric it was handed.
vi.mock("@/components/journal/reports/report-chart", () => ({
  ReportChart: ({ metric }: { metric: { label: string } }) => (
    <div data-testid="chart">{metric.label}</div>
  ),
}));

const account = (id: string, currency = "USD"): Account =>
  ({
    id,
    name: id,
    currency,
    starting_balance: 10_000,
    timezone: "UTC",
    is_active: true,
    breakeven_from: null,
    breakeven_to: null,
    breakeven_unit: null,
  }) as unknown as Account;

const rows = (specs: TradeSpec[]): TradeRow[] => specs.map((s) => mkTrade(s).row);

const OTHER = account("bt");
const LIVE = account("live");
const replaceState = vi.fn();

beforeEach(() => {
  search = new URLSearchParams();
  replaceState.mockReset();
  vi.spyOn(window.history, "replaceState").mockImplementation(replaceState);
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

const lastUrl = () => String(replaceState.mock.calls.at(-1)?.[2] ?? "");
/** The overview's trade count — the first "Trades" on the page; the table header is the second. */
const bookCount = () => screen.getAllByText("Trades")[0].nextSibling;

describe("which book the report covers", () => {
  it("every account by default, and one when a link names it", () => {
    const trades = rows([
      { accountId: "bt", net: 100 },
      { accountId: "live", net: -40 },
    ]);
    render(<ReportsWorkbench accounts={[OTHER, LIVE]} trades={trades} />);
    expect(bookCount()).toHaveTextContent("2");
    cleanup();
    search = new URLSearchParams("acc=live");
    render(<ReportsWorkbench accounts={[OTHER, LIVE]} trades={trades} />);
    expect(bookCount()).toHaveTextContent("1");
  });

  it("offers no Live / Backtest choice — the book is Topstep only (H2)", () => {
    render(<ReportsWorkbench accounts={[LIVE]} trades={rows([{ accountId: "live" }])} />);
    expect(screen.queryByRole("button", { name: "Backtest" })).not.toBeInTheDocument();
  });
});

describe("nothing to show says so once", () => {
  it("an empty journal", () => {
    render(<ReportsWorkbench accounts={[OTHER]} trades={[]} />);
    expect(screen.getByText("No closed trades yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("filters that exclude everything offer to clear them", async () => {
    const user = userEvent.setup({ delay: null });
    search = new URLSearchParams("from=2030-01-01");
    render(<ReportsWorkbench accounts={[OTHER]} trades={rows([{ accountId: "bt" }])} />);
    expect(screen.getByText("No trades match these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(lastUrl()).not.toContain("from=");
  });
});

describe("controls", () => {
  const book = () => (
    <ReportsWorkbench
      accounts={[OTHER]}
      trades={rows([
        { accountId: "bt", net: 100 },
        { accountId: "bt", net: -40 },
      ])}
    />
  );

  it("the eye hides amounts through the URL", async () => {
    const user = userEvent.setup({ delay: null });
    render(book());
    await user.click(screen.getByRole("button", { name: "Hide amounts" }));
    expect(lastUrl()).toContain("hide=1");
  });

  it("amounts are masked while hidden", () => {
    search = new URLSearchParams("hide=1");
    render(book());
    expect(screen.queryByText("$60.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("•••").length).toBeGreaterThan(0);
  });

  it("the chart shows the column the table is sorted by", async () => {
    search = new URLSearchParams("sort=win_rate:desc");
    render(book());
    expect(await screen.findByTestId("chart")).toHaveTextContent("Win %");
  });

  it("Reset drops every report choice", async () => {
    const user = userEvent.setup({ delay: null });
    search = new URLSearchParams("dim=instrument&sort=net_pnl:asc&min=1&hide=1");
    render(book());
    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect(lastUrl()).toBe("/reports");
  });

  it("an unknown dimension in a link falls back instead of blanking the page", () => {
    search = new URLSearchParams("dim=deleted_field");
    render(book());
    expect(screen.getByText("By setup grade")).toBeInTheDocument();
  });
});

describe("compare mode", () => {
  const book = rows([
    { accountId: "live", instrument: "XAUUSD", net: 100, r: 1 },
    { accountId: "live", instrument: "XAUUSD", net: -50, r: -1 },
    { accountId: "live", instrument: "EURUSD", net: 80, r: 1 },
  ]);

  it("is off until asked for, and then writes itself into the URL", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReportsWorkbench accounts={[LIVE]} trades={book} />);

    const button = screen.getByRole("button", { name: "Compare" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("B from")).not.toBeInTheDocument();

    await user.click(button);
    expect(lastUrl()).toContain("cmp=1");
  });

  it("shows a second filter set and the Δ column once it is on", () => {
    search = new URLSearchParams("cmp=1&f2=instrument:in:XAUUSD");
    render(<ReportsWorkbench accounts={[LIVE]} trades={book} />);

    expect(screen.getByLabelText("B from")).toBeInTheDocument();
    expect(screen.getByLabelText("A from")).toBeInTheDocument();
    expect(screen.getAllByText("Δ").length).toBeGreaterThan(0);
  });

  it("takes set B with it when it is turned off — a hidden filter is unreadable", async () => {
    const user = userEvent.setup({ delay: null });
    search = new URLSearchParams("cmp=1&f2=instrument:in:XAUUSD&from2=2026-01-01");
    render(<ReportsWorkbench accounts={[LIVE]} trades={book} />);

    await user.click(screen.getByRole("button", { name: "Compare" }));
    const url = lastUrl();
    expect(url).not.toContain("cmp=1");
    expect(url).not.toContain("f2=");
    expect(url).not.toContain("from2=");
  });
});
