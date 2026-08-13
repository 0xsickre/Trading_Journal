import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalGrid } from "./journal-grid";
import { mkTrade } from "@/lib/journal/reports/test-helpers";
import type { Account, TradeRow } from "@/lib/journal/types";

/**
 * Tier 1 per the phase plan: 5 `useMemo` and a row computation living in BOTH
 * `accessorFn` (what TanStack sorts on) and the cell renderer (what the reader
 * sees) — two places the same number has to agree, and nothing forces them
 * to. This file is the render-layer check for the grid's own arithmetic
 * (breakeven classification, filter matching) and its stateful controls
 * (search, sort, column visibility, export, row actions).
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const deleteTradeMock = vi.fn();
const activateTradeMock = vi.fn();
vi.mock("@/app/(app)/trades/actions", () => ({
  deleteTrade: (id: string) => deleteTradeMock(id),
  activateTrade: (id: string) => activateTradeMock(id),
}));

const setHiddenColumnsMock = vi.fn();
vi.mock("@/app/(app)/journal/actions", () => ({
  setJournalHiddenColumns: (ids: string[]) => setHiddenColumnsMock(ids),
}));

// `<Toaster/>` lives in the root layout, not in anything this file renders,
// so a real `toast.error(...)` call has nowhere to mount text into — assert
// on the call instead of DOM output.
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

const unparseMock = vi.fn((_rows: unknown) => "csv,data");
vi.mock("papaparse", () => ({ default: { unparse: (r: unknown) => unparseMock(r) } }));

const jsonToSheetMock = vi.fn((_rows: unknown) => ({}));
const bookNewMock = vi.fn(() => ({}));
const bookAppendSheetMock = vi.fn();
const writeFileMock = vi.fn();
vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: (r: unknown) => jsonToSheetMock(r),
    book_new: () => bookNewMock(),
    book_append_sheet: (...args: unknown[]) => bookAppendSheetMock(...args),
  },
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

function account(over: Partial<Account> & { id: string }): Account {
  return {
    name: "Account",
    broker: null,
    currency: "USD",
    starting_balance: 10_000,
    default_asset_class: null,
    timezone: "America/New_York",
    is_active: true,
    breakeven_from: 0,
    breakeven_to: 0,
    breakeven_unit: "currency",
    default_commission_per_unit: 0,
    default_fee_fixed: 0,
    default_swap_per_day: 0,
    default_stop_pct: null,
    default_target_pct: null,
    ftmo_mode: false,
    ftmo_daily_loss_enabled: false,
    ftmo_daily_loss_pct: 0,
    ftmo_max_loss_enabled: false,
    ftmo_max_loss_pct: 0,
    ftmo_profit_target_enabled: false,
    ftmo_profit_target_pct: 0,
    ftmo_min_days_enabled: false,
    ftmo_min_days: 0,
    ftmo_reset_at: null,
    ...over,
  } as unknown as Account;
}

const rowsOf = (trades: ReturnType<typeof mkTrade>[]): TradeRow[] => trades.map((t) => t.row);

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  deleteTradeMock.mockReset().mockResolvedValue({ ok: true });
  activateTradeMock.mockReset().mockResolvedValue({ ok: true });
  setHiddenColumnsMock.mockReset().mockResolvedValue({ ok: true });
  unparseMock.mockClear();
  jsonToSheetMock.mockClear();
  writeFileMock.mockClear();
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
});

describe("search matches instrument, notes and tags — not other fields", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [
    mkTrade({ id: "t1", instrument: "EURUSD" }),
    mkTrade({ id: "t2", instrument: "XAUUSD" }),
  ];

  it("narrows to the row whose instrument matches, case-insensitively", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);
    await user.type(screen.getByPlaceholderText(/Search notes/), "eurusd");
    expect(screen.getByText(/1 of 2 trades/)).toBeInTheDocument();
    expect(screen.getByText("EURUSD")).toBeInTheDocument();
    expect(screen.queryByText("XAUUSD")).not.toBeInTheDocument();
  });
});

describe("outcome filter classifies by EACH account's own breakeven band", () => {
  // Same net P&L, −30, on two accounts with different bands: a loss on the
  // account with no band (EXACT_ZERO_RANGE), a breakeven on the one whose
  // band reaches −50. Collapsing the two into one global band would put both
  // trades on the same side of the filter.
  const TIGHT = account({ id: "acc-tight", breakeven_from: 0, breakeven_to: 0 });
  const WIDE = account({ id: "acc-wide", breakeven_from: -50, breakeven_to: 50 });
  const trades = [
    mkTrade({ id: "t1", instrument: "EURUSD", net: -30, accountId: "acc-tight" }),
    mkTrade({ id: "t2", instrument: "XAUUSD", net: -30, accountId: "acc-wide" }),
  ];

  it("the same −30 net is a loss on one account and breakeven on the other", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[TIGHT, WIDE]} />);

    // The dimension filters moved behind the Filters popover; the assertion
    // below is unchanged, only the path to the control is longer now.
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(screen.getByText("Outcome:").closest("button")!);
    await user.click(await screen.findByRole("option", { name: "breakeven" }));

    expect(screen.getByText(/1 of 2 trades/)).toBeInTheDocument();
    expect(screen.getByText("XAUUSD")).toBeInTheDocument(); // acc-wide's trade
    expect(screen.queryByText("EURUSD")).not.toBeInTheDocument(); // acc-tight's, a real loss
  });
});

describe("sorting by a column header flips row order", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [
    mkTrade({ id: "t1", instrument: "SMALL", net: 50 }),
    mkTrade({ id: "t2", instrument: "BIG", net: 500 }),
  ];

  it("clicking Net once sorts ascending", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);
    await user.click(screen.getByRole("button", { name: /Net/ }));

    const instrumentCells = screen.getAllByText(/^SMALL$|^BIG$/);
    expect(instrumentCells[0].textContent).toBe("SMALL"); // 50 before 500, ascending
  });
});

describe("row click navigates, the actions cell does not propagate", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [mkTrade({ id: "t1" })];

  it("clicking anywhere in the row pushes to the edit page", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);
    await user.click(screen.getByText("EURUSD"));
    expect(pushMock).toHaveBeenCalledWith("/trades/t1/edit");
  });

  it("opening the row menu does not also navigate the row", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);
    pushMock.mockClear();
    const menuButtons = screen.getAllByRole("button", { name: "" });
    const rowMenu = menuButtons[menuButtons.length - 1];
    await user.click(rowMenu);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("the column picker refuses to empty the grid", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [mkTrade({ id: "t1" })];
  // Every hideable column but "net" already hidden — "net" is the last one
  // standing.
  const ALL_BUT_NET = [
    "trade_no", "date", "instrument", "direction", "setup_grade", "size",
    "avg_entry", "slippage_r", "avg_exit", "r", "exit_eff", "capture",
    "gross", "status", "chart",
  ];

  it("the last visible column's checkbox is disabled and toggling it saves nothing", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} hiddenColumns={ALL_BUT_NET} />);

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    const netItem = screen.getByRole("menuitemcheckbox", { name: "Net" });
    expect(netItem).toHaveAttribute("aria-disabled", "true");

    await user.click(netItem);
    expect(setHiddenColumnsMock).not.toHaveBeenCalled();

    // Close the dropdown before checking the table: Radix marks the rest of
    // the page `aria-hidden` while it's open, which `getByRole` respects.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("columnheader", { name: /Net/ })).toBeInTheDocument();
  });

  it("hiding a column that is NOT the last one saves optimistically", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Chart" }));

    expect(setHiddenColumnsMock).toHaveBeenCalledWith(
      expect.arrayContaining(["chart"]),
    );
  });

  it("reverts the hide and shows an error toast when the save fails", async () => {
    setHiddenColumnsMock.mockResolvedValue({ ok: false, error: "network failed" });
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Chart" }));

    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("network failed"));
  });
});

describe("row actions", () => {
  const ACCOUNT = account({ id: "acc-1" });

  it("delete calls the server action and refreshes the route on success", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf([mkTrade({ id: "t1" })])} accounts={[ACCOUNT]} />);

    const menuButtons = screen.getAllByRole("button", { name: "" });
    await user.click(menuButtons[menuButtons.length - 1]);
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));

    expect(deleteTradeMock).toHaveBeenCalledWith("t1");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("'Move to active' only appears for a planned trade", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <JournalGrid
        trades={rowsOf([mkTrade({ id: "t1", status: "closed" })])}
        accounts={[ACCOUNT]}
      />,
    );
    const menuButtons = screen.getAllByRole("button", { name: "" });
    await user.click(menuButtons[menuButtons.length - 1]);
    expect(screen.queryByRole("menuitem", { name: /Move to active/ })).not.toBeInTheDocument();
  });
});

describe("export", () => {
  const ACCOUNT = account({ id: "acc-1" });

  it("shows an error toast instead of exporting an empty filtered set", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={[]} accounts={[ACCOUNT]} />);
    // CSV and Excel are two items under one Export button now.
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByRole("menuitem", { name: "CSV" }));
    expect(toastErrorMock).toHaveBeenCalledWith("Nothing to export");
  });

  it("CSV export unparses one row per filtered trade, carrying Net P/L", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <JournalGrid trades={rowsOf([mkTrade({ id: "t1", net: 100, r: 1 })])} accounts={[ACCOUNT]} />,
    );
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByRole("menuitem", { name: "CSV" }));

    await vi.waitFor(() => expect(unparseMock).toHaveBeenCalled());
    const rows = unparseMock.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]["Net P/L"]).toBe(100);
  });

  it("Excel export writes the same row shape through xlsx, not a second code path", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <JournalGrid trades={rowsOf([mkTrade({ id: "t1", net: 250 })])} accounts={[ACCOUNT]} />,
    );
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Excel" }));

    await vi.waitFor(() => expect(jsonToSheetMock).toHaveBeenCalled());
    const rows = jsonToSheetMock.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]["Net P/L"]).toBe(250);
    expect(writeFileMock).toHaveBeenCalledWith(expect.anything(), "journal.xlsx");
  });
});
