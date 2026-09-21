import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const account = (id: string, kind: "trading" | "backtest", currency = "USD"): Account =>
  ({
    id,
    name: id,
    account_kind: kind,
    currency,
    starting_balance: 10_000,
    timezone: "UTC",
    is_active: true,
    breakeven_from: null,
    breakeven_to: null,
    breakeven_unit: null,
  }) as unknown as Account;

const rows = (specs: TradeSpec[]): TradeRow[] => specs.map((s) => mkTrade(s).row);

const BACKTEST = account("bt", "backtest");
const LIVE = account("live", "trading");
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

describe("which book the report opens on", () => {
  it("a journal of backtests opens on Backtest", () => {
    render(
      <ReportsWorkbench
        accounts={[BACKTEST, LIVE]}
        trades={rows([
          { accountId: "bt", net: 100 },
          { accountId: "bt", net: -40 },
          { accountId: "bt", net: 60 },
        ])}
      />,
    );
    expect(screen.getByRole("button", { name: "Backtest" })).toHaveAttribute("aria-pressed", "true");
    expect(bookCount()).toHaveTextContent("3");
  });

  it("opens on Live once a live trade exists, and keeps backtests out of it", () => {
    render(
      <ReportsWorkbench
        accounts={[BACKTEST, LIVE]}
        trades={rows([
          { accountId: "bt", net: 100 },
          { accountId: "live", net: -40 },
        ])}
      />,
    );
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
    expect(bookCount()).toHaveTextContent("1");
  });

  it("switching the kind writes the URL, never the server, and forgets the account", async () => {
    const user = userEvent.setup({ delay: null });
    search = new URLSearchParams("kind=live&acc=live");
    render(<ReportsWorkbench accounts={[BACKTEST, LIVE]} trades={rows([{ accountId: "live" }])} />);
    await user.click(screen.getByRole("button", { name: "Backtest" }));
    expect(lastUrl()).toBe("/reports?kind=backtest");
    expect(localStorage.getItem("tj:reports_kind")).toBe("backtest");
  });

  it("a EUR live account does not block a USD backtest", () => {
    render(
      <ReportsWorkbench
        accounts={[BACKTEST, account("eur", "trading", "EUR")]}
        trades={rows([{ accountId: "bt", net: 100 }])}
      />,
    );
    expect(screen.queryByText(/different currencies/)).not.toBeInTheDocument();
    expect(bookCount()).toHaveTextContent("1");
  });
});

describe("nothing to show says so once", () => {
  it("an empty journal", () => {
    render(<ReportsWorkbench accounts={[BACKTEST]} trades={[]} />);
    expect(screen.getByText("No closed trades yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("filters that exclude everything offer to clear them", async () => {
    const user = userEvent.setup({ delay: null });
    search = new URLSearchParams("kind=backtest&from=2030-01-01");
    render(<ReportsWorkbench accounts={[BACKTEST]} trades={rows([{ accountId: "bt" }])} />);
    expect(screen.getByText("No trades match these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(lastUrl()).toBe("/reports?kind=backtest");
  });
});

describe("controls", () => {
  const book = () => (
    <ReportsWorkbench
      accounts={[BACKTEST]}
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

  it("Reset keeps the book and drops every report choice", async () => {
    const user = userEvent.setup({ delay: null });
    search = new URLSearchParams("kind=backtest&dim=instrument&sort=net_pnl:asc&min=1&hide=1");
    render(book());
    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect(lastUrl()).toBe("/reports?kind=backtest");
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
