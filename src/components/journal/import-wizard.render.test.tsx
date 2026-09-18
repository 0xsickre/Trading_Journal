import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportWizard, type MatchCandidate } from "./import-wizard";
import type { Account } from "@/lib/journal/types";

/**
 * "Refused cells (unreadable: qty, fee) on screen, the create/merge/skip
 * classification, and an ambiguous date and `1,234` shown as refused rather
 * than as parsed" — the plan's own stated goal for this step.
 * `parseImportNumber`/`parseImportTime` are already proven in isolation;
 * this file proves the wizard actually SHOWS a refused cell rather than
 * quietly defaulting it to 0 or "now", which is the whole reason those two
 * functions refuse instead of guess.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

const commitImportMock = vi.fn();
vi.mock("@/app/(app)/import/actions", () => ({
  commitImport: (...a: unknown[]) => commitImportMock(...a),
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

const ACCOUNT = account({ id: "acc-1" });

function csvFile(name: string, csv: string): File {
  return new File([csv], name, { type: "text/csv" });
}

async function upload(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
}

beforeEach(() => {
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
  commitImportMock.mockReset().mockResolvedValue({
    ok: true,
    created: 1,
    merged: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  });
});

describe("ambiguous cells are shown as refused, not silently defaulted", () => {
  it("'1,234' (qty) and '02/03/2026' (entry time) both surface as unreadable", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);

    await upload(
      user,
      csvFile(
        "broker.csv",
        'Symbol,Direction,Qty,Entry Price,Entry Time\nEURUSD,Buy,"1,234",1.2000,02/03/2026 10:00\n',
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("EURUSD").closest("tr")!;
    expect(within(row).getByText(/unreadable:/)).toHaveTextContent("qty");
    expect(within(row).getByText(/unreadable:/)).toHaveTextContent("entry time");
  });

  it("a clean, unambiguous row reads no rejected cells and imports as new/create", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);

    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Fee\n" +
          "EURUSD,Buy,1,1.2000,2026-01-05 10:00,1.2050,2026-01-05 14:00,2.50\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("EURUSD").closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument(); // the Differences cell — everything else is populated
    expect(within(row).getByText("new")).toBeInTheDocument();
  });
});

describe("a missing exit time falls back to the entry's own timestamp, never to today", () => {
  it("commits the exit execution stamped with the entry time, not new Date()", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);

    // No "Exit Time" column at all — only a price. 2020 is nowhere near this
    // test's real run date, so a regression to `?? new Date()` is
    // unmistakable in the commit payload.
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price\n" +
          "EURUSD,Buy,1,1.2000,2020-01-01 09:00,1.2100\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const items = commitImportMock.mock.calls[0][0].items;
    const entry = items[0].executions.find((e: { side: string }) => e.side === "entry");
    const exit = items[0].executions.find((e: { side: string }) => e.side === "exit");
    expect(exit.executed_at).toBe(entry.executed_at);
    expect(exit.executed_at.startsWith("2020")).toBe(true);
  });
});

describe("classification against existing trades", () => {
  const CANDIDATES: MatchCandidate[] = [
    {
      id: "pos-dup",
      instrument: "EURUSD",
      direction: "Long",
      avgEntry: 1.2,
      avgExit: 1.205,
      openedAt: "2026-01-05T15:00:00Z", // 10:00 America/New_York
      totalFees: 2.5,
      totalSwap: 0,
      grossPl: 502.5,
      netPl: 500,
    },
    {
      id: "pos-diff",
      instrument: "XAUUSD",
      direction: "Long",
      avgEntry: 2000,
      avgExit: 2100, // will differ from the imported 2050 → shows as "match"
      openedAt: "2026-01-06T15:00:00Z",
      totalFees: 0,
      totalSwap: 0,
      grossPl: 200,
      netPl: 200,
    },
  ];

  it("an exact repeat is a duplicate, defaulted to skip", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Fee\n" +
          "EURUSD,Buy,1,1.2000,2026-01-05 10:00,1.2050,2026-01-05 14:00,2.50\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("EURUSD").closest("tr")!;
    expect(within(row).getByText("duplicate")).toBeInTheDocument();
    expect(within(row).getByText("Skip")).toBeInTheDocument();
  });

  it("a match with a different exit price is 'match', defaulted to merge, and shows the diff", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time\n" +
          "XAUUSD,Buy,1,2000,2026-01-06 10:00,2050,2026-01-06 14:00\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).getByText("match")).toBeInTheDocument();
    expect(within(row).getByText("Merge")).toBeInTheDocument();
    expect(within(row).getByText(/exit 2,100.*2,050/)).toBeInTheDocument();
  });

  it("a statement corrects the profit and swap on a hand-entered trade", async () => {
    // This is the check that makes the import worth having even when the trades
    // are already entered: the broker is authoritative for money, the human for
    // everything else. The trade in the database carries gross 200 and swap 0;
    // the statement says 214.30 and 1.25.
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Swap,Profit\n" +
          "XAUUSD,Buy,1,2000,2026-01-06 10:00,2100,2026-01-06 14:00,1.25,214.30\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    // The exit price MATCHES (2100), so the row would not be a 'match' if money
    // were not compared — without these two checks it would be 'duplicate' and
    // skipped.
    expect(within(row).getByText("match")).toBeInTheDocument();
    expect(within(row).getByText("Merge")).toBeInTheDocument();
    expect(row.textContent).toContain("profit 200→214.3");
    expect(row.textContent).toContain("swap 0→1.25");
  });

  it("fee and swap are compared separately, so they cannot cancel out", async () => {
    // The trade carries fee 2.50 and swap 0. The statement says fee 0 and swap
    // 2.50 — the sum is the same, so the earlier comparison (fee+swap as one
    // number) saw this as a perfect match and skipped the row.
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Fee,Swap\n" +
          "EURUSD,Buy,1,1.2000,2026-01-05 10:00,1.2050,2026-01-05 14:00,0,2.50\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("EURUSD").closest("tr")!;
    expect(within(row).getByText("match")).toBeInTheDocument();
    expect(row.textContent).toContain("fee 2.5→0");
    expect(row.textContent).toContain("swap 0→2.5");
  });

  it("a brand new instrument has nothing to merge into — Merge is disabled in its own row", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time\nGBPUSD,Buy,1,1.30,2026-01-07 10:00\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("GBPUSD").closest("tr")!;
    await user.click(within(row).getByRole("combobox"));
    expect(await screen.findByRole("option", { name: "Merge" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("the decision select lets the reader override create → skip per row", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time\nGBPUSD,Buy,1,1.30,2026-01-07 10:00\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("GBPUSD").closest("tr")!;
    await user.click(within(row).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Skip" }));

    await user.click(screen.getByRole("button", { name: /Commit import/ }));
    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    expect(commitImportMock.mock.calls[0][0].items[0].decision).toBe("skip");
  });
});

describe("required-column guard and partial-failure reporting", () => {
  it("refuses to reconcile until every required column is mapped", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    // "Direction" header deliberately absent — a required column with
    // nothing to auto-map.
    await upload(user, csvFile("broker.csv", "Symbol,Qty,Entry Price,Entry Time\nEURUSD,1,1.2,2026-01-05 10:00\n"));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("direction"));
    // Still on step 1 — no review table rendered.
    expect(screen.queryByRole("button", { name: /Commit import/ })).not.toBeInTheDocument();
  });

  it("names the failed rows and reason rather than a bare count", async () => {
    commitImportMock.mockResolvedValue({
      ok: true,
      created: 0,
      merged: 0,
      skipped: 0,
      failed: 1,
      errors: [{ row: 1, instrument: "EURUSD", error: "missing account" }],
    });
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(
      user,
      csvFile("broker.csv", "Symbol,Direction,Qty,Entry Price,Entry Time\nEURUSD,Buy,1,1.2,2026-01-05 10:00\n"),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const call = toastErrorMock.mock.calls.find(([msg]) => String(msg).includes("1 row"))!;
    const opts = call[1] as { description: string };
    expect(opts.description).toContain("row 1 (EURUSD): missing account");
  });
});

describe("TradingView's list of trades", () => {
  const HEADERS = [
    "Trade number", "Type", "Date and time", "Signal", "Price USD", "Size (qty)",
    "Size (value)", "Net PnL USD", "Return %", "Commission USD",
    "Favorable excursion USD", "Favorable excursion %", "Adverse excursion USD",
    "Adverse excursion %", "Cumulative PnL USD", "Cumulative PnL %", "Duration (bars)",
  ];
  const at = (h: number) => Date.UTC(2023, 8, 20, h) / 86_400_000 + 25569;
  const XCU = [{ symbol: "XCUUSD", point_value: 100 }];

  /** The real export's shape: a summary sheet first, the trades on "Trades", exit row first. */
  async function tvFile(name = "Replay_Trading_OANDA_XCUUSD_2026-09-18_f1e45.xlsx"): Promise<File> {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["", "All USD"], ["Net profit", -2994.8]]),
      "Performance",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        HEADERS,
        [1, "Exit long", at(15), "Bracket Stop Loss", 3.71195, 53610, 199997.466, -2994.8, -1.49, 1994.98, 0, 0, -1999.81, -0.99, -2994.8, -2.99, 1],
        [1, "Entry long", at(14), "Buy limit order", 3.7306, 53610, 199997.466, -2994.8, -1.49, 1994.98, 0, 0, -1999.81, -0.99, -2994.8, -2.99, 1],
      ]),
      "Trades",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new File([buf], name);
  }

  it("imports one trade per trade number, size in lots, times in the account's zone", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} instruments={XCU} />);
    await upload(user, await tvFile());

    expect(await screen.findByText(/TradingView export/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reconcile/ }));
    expect(screen.getAllByText("XCUUSD")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const [item] = commitImportMock.mock.calls[0][0].items;
    expect(item).toMatchObject({ instrument: "XCUUSD", direction: "Long", decision: "create" });
    // Not mapped: the money is derived, and the size check proved it equal.
    expect(item.gross_pnl_override).toBeNull();
    const entry = item.executions.find((e: { side: string }) => e.side === "entry");
    const exit = item.executions.find((e: { side: string }) => e.side === "exit");
    expect(entry).toMatchObject({ price: 3.7306, qty: 536.1, fee: 0, executed_at: "2023-09-20T18:00:00.000Z" });
    expect(exit).toMatchObject({ price: 3.71195, qty: 536.1, fee: 1994.98, executed_at: "2023-09-20T19:00:00.000Z" });
  });

  it("refuses an instrument the catalog does not know — the size cannot be converted", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} instruments={[]} />);
    await upload(user, await tvFile());
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("not in the instrument catalog"));
    expect(screen.queryByRole("button", { name: /Commit import/ })).not.toBeInTheDocument();
  });

  it("refuses an account in another currency than the export's money", async () => {
    const user = userEvent.setup({ delay: null });
    const eur = account({ id: "acc-eur", currency: "EUR" });
    render(<ImportWizard accounts={[eur]} candidates={[]} instruments={XCU} />);
    await upload(user, await tvFile());
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("Pick a USD account"));
  });

  it("refuses a renamed file — the symbol is only in the name", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} instruments={XCU} />);
    await upload(user, await tvFile("copper.xlsx"));

    await vi.waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("symbol could not be read")),
    );
    expect(screen.queryByRole("button", { name: /Reconcile/ })).not.toBeInTheDocument();
  });
});

describe("TradingView partial exits", () => {
  const HEADERS = [
    "Trade number", "Type", "Date and time", "Signal", "Price USD", "Size (qty)",
    "Net PnL USD", "Commission USD",
  ];
  const at = (h: number) => Date.UTC(2023, 1, 9, h) / 86_400_000 + 25569;

  it("one entry closed in two parts imports as one position with two exits", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["", "All USD"]]), "Performance");
    // 165 oz of gold at 1313.05, closed 50 oz at 1321.38 and 115 oz at 1351.12.
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        HEADERS,
        [1, "Exit long", at(11), "TP1", 1321.38, 50, 416.5 - 0.66, 0.66],
        [1, "Entry long", at(9), "Long", 1313.05, 50, 416.5 - 0.66, 0.66],
        [2, "Exit long", at(15), "TP2", 1351.12, 115, 4378.05 - 1.53, 1.53],
        [2, "Entry long", at(9), "Long", 1313.05, 115, 4378.05 - 1.53, 1.53],
      ]),
      "Trades",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "Replay_Trading_OANDA_XAUUSD_2026-09-18_a1b2c.xlsx");

    const user = userEvent.setup({ delay: null });
    render(
      <ImportWizard
        accounts={[ACCOUNT]}
        candidates={[]}
        instruments={[{ symbol: "XAUUSD", point_value: 100 }]}
      />,
    );
    await upload(user, file);
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    expect(screen.getAllByText("XAUUSD")).toHaveLength(1);
    expect(screen.getByText(/2 exits/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const items = commitImportMock.mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    const execs = items[0].executions as { side: string; price: number; qty: number; fee: number; executed_at: string }[];
    const entries = execs.filter((e) => e.side === "entry");
    const exits = execs.filter((e) => e.side === "exit");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ price: 1313.05, qty: 1.65, fee: 0, executed_at: "2023-02-09T14:00:00.000Z" });
    expect(exits.map((e) => [e.price, e.qty, e.fee])).toEqual([
      [1321.38, 0.5, 0.66],
      [1351.12, 1.15, 1.53],
    ]);
    // Fully closed: the exits add up to the entry exactly, not to a rounding residue under it.
    expect(exits.reduce((s, e) => s + e.qty, 0)).toBe(entries[0].qty);
  });
});

describe("a trade already typed by hand, recognised without the time", () => {
  /**
   * The case the journal is used in: the trade was typed while reading a
   * backtest, so it carries 18 September — the day it was TYPED — and the file
   * carries 7 March, the day it was traded. Before this, the two lived on as
   * duplicates and nothing in the journal could join them.
   */
  const TYPED: MatchCandidate[] = [
    {
      id: "pos-typed",
      instrument: "XAUUSD",
      direction: "Long",
      avgEntry: 1327.45,
      avgExit: 1317.62,
      openedAt: "2026-09-19T01:10:00Z", // 21:10 America/New_York on 18 Sep
      totalFees: 0,
      totalSwap: 0,
      grossPl: -983.4,
      netPl: -983.4,
      accountId: "acc-1",
      entryQty: 1,
      tradeNo: 5,
    },
  ];

  const FILE =
    "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Profit\n" +
    "XAUUSD,Buy,1,1327.45,2026-03-07 09:00,1317.62,2026-03-07 15:00,-983.40\n";

  it("is offered as the same trade, with merge already chosen", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={TYPED} />);
    await upload(user, csvFile("backtest.csv", FILE));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).getByText("suggested")).toBeInTheDocument();
    expect(within(row).getByText("Merge")).toBeInTheDocument();
    // Named, so the reader recognises their own trade before committing.
    expect(within(row).getByText(/same trade as #5/)).toBeInTheDocument();
  });

  it("says the time it is about to correct, which is what kept them apart", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={TYPED} />);
    await upload(user, csvFile("backtest.csv", FILE));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).getByText(/opened 18\/09 21:10→07\/03 09:00/)).toBeInTheDocument();
  });

  it("commits it as a merge into that trade", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={TYPED} />);
    await upload(user, csvFile("backtest.csv", FILE));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const [item] = commitImportMock.mock.calls[0][0].items;
    expect(item).toMatchObject({
      decision: "merge",
      match_status: "suggested",
      matched_position_id: "pos-typed",
    });
    // The private review-only fields never travel to the server.
    expect(item._candidates).toBeUndefined();
    expect(item._diff).toBeUndefined();
  });

  it("two equally good candidates are pointed at one by hand, not guessed", async () => {
    const user = userEvent.setup({ delay: null });
    const twin = { ...TYPED[0], id: "pos-twin", tradeNo: 9 };
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[...TYPED, twin]} />);
    await upload(user, csvFile("backtest.csv", FILE));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).getByText("ambiguous")).toBeInTheDocument();
    // Defaults to create: a merge deletes the fills of whichever trade it lands on.
    expect(within(row).getByText("Create new")).toBeInTheDocument();

    // Two selects in the cell: the candidate picker first, the decision second.
    await user.click(within(row).getAllByRole("combobox")[0]);
    await user.click(await screen.findByText(/#9/));
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const [item] = commitImportMock.mock.calls[0][0].items;
    expect(item).toMatchObject({ decision: "merge", matched_position_id: "pos-twin" });
  });

  it("never crosses accounts: the same numbers on another account are a new trade", async () => {
    const user = userEvent.setup({ delay: null });
    const elsewhere = [{ ...TYPED[0], accountId: "acc-other" }];
    render(<ImportWizard accounts={[ACCOUNT]} candidates={elsewhere} />);
    await upload(user, csvFile("backtest.csv", FILE));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).getByText("new")).toBeInTheDocument();
  });
});

describe("the target comes from the file, the stop never does", () => {
  it("maps a T/P column and sends it with the row", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(
      user,
      csvFile(
        "mt5.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,S/L,T/P\n" +
          "EURUSD,Buy,1,1.2000,2026-01-05 10:00,1.1950,1.2200\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    await user.click(screen.getByRole("button", { name: /Commit import/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const [item] = commitImportMock.mock.calls[0][0].items;
    expect(item.target_price).toBe(1.22);
  });

  it("has no stop column at all — a stop pulled to breakeven would rewrite the risk", () => {
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    expect(screen.queryByText(/Stop/)).not.toBeInTheDocument();
  });
});
