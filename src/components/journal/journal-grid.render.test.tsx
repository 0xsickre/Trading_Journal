import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalGrid } from "./journal-grid";
import { mkTrade } from "@/lib/journal/reports/test-helpers";
import type { Account, OptionsMap, TradeRow } from "@/lib/journal/types";

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
const bulkDeleteTradesMock = vi.fn();
const bulkAddTagMock = vi.fn();
const mergeTradesMock = vi.fn();
vi.mock("@/app/(app)/trades/actions", () => ({
  deleteTrade: (id: string) => deleteTradeMock(id),
  bulkDeleteTrades: (ids: string[]) => bulkDeleteTradesMock(ids),
  bulkAddTag: (ids: string[], kind: string, values: string[]) =>
    bulkAddTagMock(ids, kind, values),
  mergeTrades: (keepId: string, fillsFromId: string) =>
    mergeTradesMock(keepId, fillsFromId),
}));

// `TagMultiSelect` (used by the bulk "Add tag" dialog) imports this for its
// create-new-option path; unused here since the tests only pick EXISTING
// options, but the module import still needs a mock to resolve.
vi.mock("@/app/(app)/settings/actions", () => ({
  addOption: vi.fn(),
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

const OPTIONS_MAP: OptionsMap = {
  technical_tag: [
    {
      id: "o1",
      value: "FVG",
      label: "FVG",
      color: null,
      description: null,
      is_active: true,
      sort_order: 0,
    },
  ],
};

beforeEach(() => {
  // The grid remembers its view per tab; a search typed in one test must not
  // narrow the next one.
  window.sessionStorage.clear();
  pushMock.mockClear();
  refreshMock.mockClear();
  deleteTradeMock.mockReset().mockResolvedValue({ ok: true });
  bulkDeleteTradesMock.mockReset().mockResolvedValue({ ok: true, deleted: 0 });
  bulkAddTagMock.mockReset().mockResolvedValue({ ok: true });
  mergeTradesMock.mockReset().mockResolvedValue({ ok: true });
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

  it("FINDS A TRADE BY ITS MISTAKE, which was not searchable at all before", async () => {
    // `mistake` was never in the haystack — not even while it was a plain
    // string. Becoming a `text[]` put it alongside the other tag arrays, and
    // the omission only became visible then. "Which trades did I move the stop
    // on?" is the question the field exists to answer.
    const tagged = [
      mkTrade({ id: "t1", instrument: "EURUSD", mistake: ["Moved stop"] }),
      mkTrade({ id: "t2", instrument: "XAUUSD", mistake: ["Late entry"] }),
    ];
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(tagged)} accounts={[ACCOUNT]} />);
    await user.type(screen.getByPlaceholderText(/Search notes/), "moved stop");

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
    await user.click(await screen.findByRole("option", { name: "Breakeven" }));

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
    await user.click(screen.getByRole("button", { name: "Trade actions" }));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("the column picker refuses to empty the grid", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [mkTrade({ id: "t1" })];
  // Every hideable column but "net" already hidden — "net" is the last one
  // standing.
  const ALL_BUT_NET = [
    "trade_no", "date", "instrument", "direction", "playbook", "setup_grade",
    "plan_entry", "stop_price", "target_price", "size",
    "avg_entry", "slippage_r", "avg_exit", "hold", "r", "exit_eff", "capture",
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

  it("delete ASKS first, then calls the server action and refreshes", async () => {
    // It used to delete on the menu click itself — fills, rule answers and
    // snapshots gone on one mis-click, while the bulk path asked first.
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf([mkTrade({ id: "t1" })])} accounts={[ACCOUNT]} />);

    await user.click(screen.getByRole("button", { name: "Trade actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));

    expect(deleteTradeMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: /Delete trade/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteTradeMock).toHaveBeenCalledWith("t1"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("Cancel on the single-delete question deletes nothing", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf([mkTrade({ id: "t1" })])} accounts={[ACCOUNT]} />);

    await user.click(screen.getByRole("button", { name: "Trade actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(deleteTradeMock).not.toHaveBeenCalled();
  });

  it("offers no 'Move to active' at all — the fills decide the phase", async () => {
    // Planned or active is what the fills say: an entry fill means the trader
    // is in the trade. A menu item that could set it by hand could only ever
    // disagree with the record, so it is gone even for a planned trade.
    const user = userEvent.setup({ delay: null });
    render(
      <JournalGrid
        trades={rowsOf([mkTrade({ id: "t1", status: "planned" })])}
        accounts={[ACCOUNT]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Trade actions" }));
    expect(await screen.findByRole("menuitem", { name: /Edit/ })).toBeInTheDocument();
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
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^trades-\d{4}-\d{2}-\d{2}\.xlsx$/),
    );
  });
});

describe("bulk selection", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [mkTrade({ id: "t1" }), mkTrade({ id: "t2" })];

  it("selecting a row's checkbox shows the count and does not navigate the row", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);

    await user.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("the header checkbox selects every row", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    for (const cb of screen.getAllByRole("checkbox", { name: "Select row" })) {
      expect(cb).toBeChecked();
    }
  });

  it("hides the Bulk actions control when nothing is selected", () => {
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);
    expect(screen.queryByRole("button", { name: /Bulk actions/ })).not.toBeInTheDocument();
  });
});

describe("bulk delete", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [mkTrade({ id: "t1" }), mkTrade({ id: "t2" })];

  async function selectAllAndOpenDelete(user: ReturnType<typeof userEvent.setup>) {
    render(<JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete selected/ }));
  }

  it("asks for confirmation naming the exact count before deleting anything", async () => {
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenDelete(user);

    expect(screen.getByRole("heading", { name: "Delete 2 trades?" })).toBeInTheDocument();
    expect(bulkDeleteTradesMock).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without calling the server action", async () => {
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenDelete(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(bulkDeleteTradesMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /Delete 2 trades/ })).not.toBeInTheDocument();
  });

  it("Delete sends every selected id, clears the selection and refreshes", async () => {
    bulkDeleteTradesMock.mockResolvedValue({ ok: true, deleted: 2 });
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenDelete(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(bulkDeleteTradesMock).toHaveBeenCalledWith(["t1", "t2"]));
    expect(toastSuccessMock).toHaveBeenCalledWith("2 trades deleted");
    expect(refreshMock).toHaveBeenCalled();
    // The dialog closes and the selection clears — the toolbar's own count
    // badge is the simplest proof, since the rows themselves are still in
    // the fixture (this test never re-renders from a real server response).
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  });

  it("shows the error toast and leaves the dialog open when the action fails", async () => {
    bulkDeleteTradesMock.mockResolvedValue({ ok: false, error: "network failed" });
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenDelete(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("network failed"));
    expect(screen.getByRole("heading", { name: "Delete 2 trades?" })).toBeInTheDocument();
  });
});

describe("bulk add tag", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [mkTrade({ id: "t1" }), mkTrade({ id: "t2" })];

  async function selectAllAndOpenTagDialog(user: ReturnType<typeof userEvent.setup>) {
    render(
      <JournalGrid trades={rowsOf(trades)} accounts={[ACCOUNT]} optionsMap={OPTIONS_MAP} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Add tag/ }));
  }

  it("Apply is disabled until a tag is picked", async () => {
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenTagDialog(user);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("picking an existing option and applying sends the category and the value to every selected trade", async () => {
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenTagDialog(user);

    // Technical is the default category; OPTIONS_MAP only seeds that list.
    await user.type(screen.getByPlaceholderText(/Type to search/), "FVG");
    await user.click(await screen.findByRole("option", { name: "FVG" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await vi.waitFor(() =>
      expect(bulkAddTagMock).toHaveBeenCalledWith(["t1", "t2"], "technical", ["FVG"]),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Tagged 2 trades");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("switching category clears whatever was already picked, so a stray tag cannot land under the wrong column", async () => {
    const user = userEvent.setup({ delay: null });
    await selectAllAndOpenTagDialog(user);

    // Read the CHIP, not any "FVG" on screen. The list stays open after a pick
    // now — that is what makes it a multi-select — so the tag is on screen
    // twice, once as the chip and once as the ticked row behind it.
    const chip = () =>
      screen.queryAllByText("FVG").find((el) => el.closest("[data-slot='badge']"));

    await user.type(screen.getByPlaceholderText(/Type to search/), "FVG");
    await user.click(await screen.findByRole("option", { name: "FVG" }));
    expect(chip()).toBeDefined();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Mistake" }));

    expect(chip()).toBeUndefined();
    expect(screen.queryByText("FVG")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});

/**
 * The bot writes trades that have a plan and no fills yet. Every value column
 * in this grid reads from `stats`, which is built from fills — so before this
 * existed, a planned trade rendered as a row of em dashes and the stop and
 * target the bridge had just delivered were not visible anywhere in the table.
 */
describe("a planned trade shows its plan", () => {
  const ACCOUNT = account({ id: "acc-1" });

  function plannedRow(): TradeRow {
    return {
      ...mkTrade({ id: "p1" }).row,
      status: "planned",
      entry_price: 1.1631,
      stop_price: 1.16101,
      target_price: 1.16453,
      tick_size_at_trade: 0.00001,
      // No fills yet — this is what makes every stats-derived column empty.
      stats: null,
    };
  }

  // The plan columns start hidden now; "__v2" is a stored choice with nothing
  // switched off, which is how a trader who turned them on sees the grid.
  it("renders entry, stop and target at the instrument's precision", () => {
    render(<JournalGrid trades={[plannedRow()]} accounts={[ACCOUNT]} hiddenColumns={["__v2"]} />);

    // Two decimals would print all three as "1.16" — one wrong fact where
    // there are three different ones.
    expect(screen.getByRole("cell", { name: "1.16310" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1.16101" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1.16453" })).toBeInTheDocument();
  });

  it("still renders the fill-derived columns as em dashes, not zeros", () => {
    render(<JournalGrid trades={[plannedRow()]} accounts={[ACCOUNT]} />);

    // A trade that has not filled has no size and no average entry. Showing 0
    // would be the "null is not zero" mistake one column to the left.
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("—");
    expect(cells).not.toContain("0.00");
  });

  it("has a column heading for each of the three plan fields", () => {
    render(<JournalGrid trades={[plannedRow()]} accounts={[ACCOUNT]} hiddenColumns={["__v2"]} />);

    expect(screen.getByRole("columnheader", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Target" })).toBeInTheDocument();
  });
});

describe("merging two rows that are the same trade", () => {
  const ACCOUNT = account({ id: "acc-1" });

  /**
   * The pair this exists for: one trade typed by hand while reading a backtest,
   * and the same trade imported afterwards. Both sit in the journal and every
   * total counts the trade twice.
   */
  function pair(over: { typedSource?: string; importedInstrument?: string } = {}) {
    const typed = mkTrade({ id: "typed", instrument: "XAUUSD" }).row;
    const imported = mkTrade({
      id: "imported",
      instrument: over.importedInstrument ?? "XAUUSD",
    }).row;
    return rowsOf([]).concat([
      { ...typed, source: over.typedSource ?? "manual", trade_no: 5 },
      { ...imported, source: "import", trade_no: 7 },
    ] as unknown as TradeRow[]);
  }

  const selectAll = async (user: ReturnType<typeof userEvent.setup>) => {
    const boxes = screen.getAllByRole("checkbox");
    // The first checkbox is the header's select-all.
    await user.click(boxes[0]);
  };

  it("offers the merge only once two rows are selected", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={pair()} accounts={[ACCOUNT]} />);

    expect(screen.queryByText(/Bulk actions/)).not.toBeInTheDocument();
    await selectAll(user);
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));
    expect(await screen.findByText(/Merge 2 trades/)).toBeInTheDocument();
  });

  it("keeps the typed trade and takes the fills from the imported one", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={pair()} accounts={[ACCOUNT]} />);
    await selectAll(user);
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));
    await user.click(await screen.findByText(/Merge 2 trades/));

    // Said in words before anything happens.
    expect(await screen.findByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByText("Stays, corrected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Merge" }));
    await vi.waitFor(() => expect(mergeTradesMock).toHaveBeenCalled());
    expect(mergeTradesMock).toHaveBeenCalledWith("typed", "imported");
  });

  it("asks nothing: the typed trade stays whichever order the rows were ticked in", async () => {
    // The rule is fixed — the import corrects the typed trade. Offering a choice
    // made the trader work out which row was which, every time.
    const user = userEvent.setup({ delay: null });
    const rows = pair();
    render(<JournalGrid trades={[rows[1], rows[0]]} accounts={[ACCOUNT]} />);
    await selectAll(user);
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));
    await user.click(await screen.findByText(/Merge 2 trades/));

    expect(screen.queryByText(/Click a trade/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Merge" }));

    await vi.waitFor(() => expect(mergeTradesMock).toHaveBeenCalled());
    expect(mergeTradesMock).toHaveBeenCalledWith("typed", "imported");
  });

  it("refuses two instruments — the item is there but cannot be used", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={pair({ importedInstrument: "NAS100" })} accounts={[ACCOUNT]} />);
    await selectAll(user);
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));

    const item = await screen.findByText(/Merge 2 trades/);
    expect(item.closest("[role='menuitem']")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the list a trader scans", () => {
  const ACCOUNT = account({ id: "acc-1" });

  it("starts with the study columns hidden, and shows them once the trader has chosen", () => {
    const { unmount } = render(
      <JournalGrid trades={rowsOf([mkTrade({ id: "t1" })])} accounts={[ACCOUNT]} />,
    );
    expect(screen.queryByRole("columnheader", { name: "Plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Net/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Hold/ })).toBeInTheDocument();
    unmount();

    render(
      <JournalGrid
        trades={rowsOf([mkTrade({ id: "t1" })])}
        accounts={[ACCOUNT]}
        hiddenColumns={["__v2"]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Plan" })).toBeInTheDocument();
  });

  it("prints fill averages at the instrument's precision, not two decimals", () => {
    const row: TradeRow = {
      ...mkTrade({ id: "fx" }).row,
      tick_size_at_trade: 0.00001,
      stats: { ...mkTrade({ id: "fx" }).row.stats!, avg_entry: 1.16101, avg_exit: 1.16453 },
    };
    render(<JournalGrid trades={[row]} accounts={[ACCOUNT]} />);
    expect(screen.getByRole("cell", { name: "1.16101" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1.16453" })).toBeInTheDocument();
  });

  it("says the FILTERS hid everything, not that there are no trades", async () => {
    const user = userEvent.setup({ delay: null });
    render(<JournalGrid trades={rowsOf([mkTrade({ id: "t1" })])} accounts={[ACCOUNT]} />);
    await user.type(screen.getByPlaceholderText(/Search notes/), "nothing-matches-this");

    expect(await screen.findByText(/No trades match these filters/)).toBeInTheDocument();
    expect(screen.queryByText(/No trades yet/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText(/1 of 1 trades/)).toBeInTheDocument();
  });

  it("sums the filtered set in the summary bar", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <JournalGrid
        trades={rowsOf([
          mkTrade({ id: "t1", instrument: "EURUSD", net: 100 }),
          mkTrade({ id: "t2", instrument: "XAUUSD", net: -40 }),
        ])}
        accounts={[ACCOUNT]}
      />,
    );
    const netCell = () => screen.getByText("Net P/L").parentElement!;
    expect(netCell()).toHaveTextContent("60");

    await user.type(screen.getByPlaceholderText(/Search notes/), "xauusd");
    await vi.waitFor(() => expect(netCell()).toHaveTextContent("40"));
    expect(screen.getByText("Win rate").parentElement).toHaveTextContent("0.0%");
  });

  it("remembers the view for the tab, so a save lands back on the same filters", async () => {
    const user = userEvent.setup({ delay: null });
    const trades = rowsOf([
      mkTrade({ id: "t1", instrument: "EURUSD" }),
      mkTrade({ id: "t2", instrument: "XAUUSD" }),
    ]);
    const { unmount } = render(<JournalGrid trades={trades} accounts={[ACCOUNT]} />);
    await user.type(screen.getByPlaceholderText(/Search notes/), "eurusd");
    expect(screen.getByText(/1 of 2 trades/)).toBeInTheDocument();
    unmount();

    render(<JournalGrid trades={trades} accounts={[ACCOUNT]} />);
    expect(await screen.findByText(/1 of 2 trades/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search notes/)).toHaveValue("eurusd");
  });

  it("drops a row from the selection once a filter hides it", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <JournalGrid
        trades={rowsOf([
          mkTrade({ id: "t1", instrument: "EURUSD" }),
          mkTrade({ id: "t2", instrument: "XAUUSD" }),
        ])}
        accounts={[ACCOUNT]}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search notes/), "eurusd");
    await vi.waitFor(() => expect(screen.getByText("1 selected")).toBeInTheDocument());
  });
});
