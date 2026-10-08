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
    default_stop_pct: null,
    default_target_pct: null,
    topstep_mode: false,
    topstep_plan: "50K" as const,
    topstep_payout_at: null,
    topstep_reset_at: null,
    risk_rule_pct: 8,
    risk_rule_min: null,
    risk_rule_max: null,
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
    batch_id: "00000000-0000-4000-8000-000000000001",
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
    // Both key cells are named once, in the line that also says why the row
    // is held back.
    expect(within(row).getByText(/unreadable/)).toHaveTextContent("qty");
    expect(within(row).getByText(/unreadable/)).toHaveTextContent("entry time");
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
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

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
    expect(within(row).getByText(/exit 2100.*2050/)).toBeInTheDocument();
  });

  it("a statement corrects the profit on a hand-entered trade", async () => {
    // This is the check that makes the import worth having even when the trades
    // are already entered: the broker is authoritative for money, the human for
    // everything else. The trade in the database carries gross 200; the
    // statement says 214.30.
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Profit\n" +
          "XAUUSD,Buy,1,2000,2026-01-06 10:00,2100,2026-01-06 14:00,214.30\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    // The exit price MATCHES (2100), so the row would not be a 'match' if money
    // were not compared — without this check it would be 'duplicate' and
    // skipped.
    expect(within(row).getByText("match")).toBeInTheDocument();
    expect(within(row).getByText("Merge")).toBeInTheDocument();
    expect(row.textContent).toContain("profit 200→214.3");
  });

  it("a statement corrects the fee on a hand-entered trade", async () => {
    // The trade carries fee 2.50; the statement says 0. Every price matches, so
    // without the fee check the row would be a 'duplicate' and skipped.
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={CANDIDATES} />);
    await upload(
      user,
      csvFile(
        "broker.csv",
        "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Fee\n" +
          "EURUSD,Buy,1,1.2000,2026-01-05 10:00,1.2050,2026-01-05 14:00,0\n",
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("EURUSD").closest("tr")!;
    expect(within(row).getByText("match")).toBeInTheDocument();
    expect(row.textContent).toContain("fee 2.5→0");
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

    await user.click(screen.getByRole("button", { name: /^Commit/ }));
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
    expect(screen.queryByRole("button", { name: /^Commit/ })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const call = toastErrorMock.mock.calls.find(([msg]) => String(msg).includes("1 row"))!;
    const opts = call[1] as { description: string };
    expect(opts.description).toContain("row 1 (EURUSD): missing account");
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
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

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
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

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

describe("a new trade takes its stop and target from the file (K3)", () => {
  it("maps the S/L and T/P columns and sends both with the row", async () => {
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
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const [item] = commitImportMock.mock.calls[0][0].items;
    expect(item.target_price).toBe(1.22);
    // Written onto a trade the import CREATES only; a merge never takes it
    // (`importedPlan` in `import-commit.ts`, called on the create path alone).
    expect(item.stop_price).toBe(1.195);
  });
});

describe("a merge is only offered when it is safe", () => {
  const TYPED: MatchCandidate[] = [
    {
      id: "pos-typed",
      instrument: "XAUUSD",
      direction: "Long",
      avgEntry: 1327.45,
      avgExit: 1317.62,
      openedAt: "2026-09-19T01:10:00Z",
      totalFees: 0,
      grossPl: -983.4,
      netPl: -983.4,
      accountId: "acc-1",
      entryQty: 1,
      tradeNo: 5,
    },
  ];
  const HEAD = "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time,Profit\n";
  const ROW = "XAUUSD,Buy,1,1327.45,2026-03-07 09:00,1317.62,2026-03-07 15:00,-983.40\n";

  it("a row whose entry time cannot be read is skipped, and cannot be merged", async () => {
    // Merged, it would replace the trade's fills with a row missing its entry.
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={TYPED} />);
    await upload(
      user,
      csvFile("bt.csv", HEAD + "XAUUSD,Buy,1,1327.45,someday,1317.62,2026-03-07 15:00,-983.40\n"),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).getByText(/cannot merge: unreadable entry time/)).toBeInTheDocument();
    expect(within(row).getByText("Skip")).toBeInTheDocument();
    await user.click(within(row).getByRole("combobox"));
    expect(await screen.findByRole("option", { name: "Merge" })).toHaveAttribute("aria-disabled", "true");
  });

  it("two rows that are the same trade: the first merges, the second is named and skipped", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={TYPED} />);
    await upload(user, csvFile("bt.csv", HEAD + ROW + ROW));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const rows = screen.getAllByText("XAUUSD").map((c) => c.closest("tr")!);
    expect(within(rows[0]).getByText("Merge")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/same trade as row 1/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Skip")).toBeInTheDocument();
    // And the second cannot be switched onto the same trade by hand.
    await user.click(within(rows[1]).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Merge" }));
    expect(toastErrorMock).toHaveBeenCalledWith("Row 1 already merges into this trade.");
  });

  it("an exact match that changes the size is not a duplicate", async () => {
    // Same instrument, side, time and prices — only the size differs. It used to
    // be called a duplicate and skipped, so the corrected size never landed.
    const user = userEvent.setup({ delay: null });
    const exact: MatchCandidate[] = [{ ...TYPED[0], openedAt: "2026-03-07T14:00:00Z" }];
    render(<ImportWizard accounts={[ACCOUNT]} candidates={exact} />);
    await upload(
      user,
      csvFile("bt.csv", HEAD + "XAUUSD,Buy,2,1327.45,2026-03-07 09:00,1317.62,2026-03-07 15:00,-983.40\n"),
    );
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));

    const row = screen.getByText("XAUUSD").closest("tr")!;
    expect(within(row).queryByText("duplicate")).not.toBeInTheDocument();
    expect(within(row).getByText(/size 1→2/)).toBeInTheDocument();
    expect(within(row).getByText("Merge")).toBeInTheDocument();
  });

  it("names the time column after the account's zone", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(user, csvFile("bt.csv", HEAD + ROW));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    expect(screen.getByText("Time (America/New_York)")).toBeInTheDocument();
  });
});

describe("a large file is committed in chunks", () => {
  const HEAD = "Symbol,Direction,Qty,Entry Price,Entry Time,Exit Price,Exit Time\n";
  const file = (n: number) =>
    csvFile(
      "big.csv",
      HEAD +
        Array.from({ length: n }, (_, i) => {
          const day = String(1 + (i % 28)).padStart(2, "0");
          const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
          return `EURUSD,Buy,1,1.1,2026-${month}-${day} 10:00,1.2,2026-${month}-${day} 14:00\n`;
        }).join(""),
    );

  it("sends 50 rows, then the rest into the same batch, starting at row 51", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(user, file(65));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalledTimes(2));
    const [first, second] = commitImportMock.mock.calls.map((c) => c[0]);
    expect(first.items).toHaveLength(50);
    expect(first.batch_id).toBeUndefined();
    expect(second.items).toHaveLength(15);
    expect(second).toMatchObject({ batch_id: "00000000-0000-4000-8000-000000000001", row_offset: 50 });
  });

  it("stops at a failed chunk and says how far it got", async () => {
    const user = userEvent.setup({ delay: null });
    commitImportMock
      .mockResolvedValueOnce({
        ok: true,
        batch_id: "00000000-0000-4000-8000-000000000001",
        created: 50,
        merged: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      })
      .mockResolvedValueOnce({ ok: false, error: "timeout" });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(user, file(65));
    await user.click(await screen.findByRole("button", { name: /Reconcile/ }));
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

    await vi.waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Imported 50 of 65 rows — the rest were not sent. Undo from history if needed.",
        expect.objectContaining({ description: "timeout" }),
      ),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

describe("TopstepX trades + orders chosen together (phase O)", () => {
  const TRADES =
    "Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration,Commissions\n" +
    "1,MNQZ6,10/07/2026 16:20:37 +02:00,10/07/2026 17:49:06 +02:00,31246.5,31366.5,1.66,720,3,Long,10/07/2026 00:00:00 -05:00,01:28:29,2.00\n" +
    "2,MNQZ6,10/08/2026 21:57:01 +02:00,10/08/2026 21:58:21 +02:00,30969.75,30978.5,1.66,52.5,3,Long,10/08/2026 00:00:00 -05:00,00:01:20,2.00\n";
  const H =
    "Id,AccountName,ContractName,Status,Type,Size,Side,CreatedAt,TradeDay,FilledAt,CancelledAt,TriggeredAt,StopPrice,LimitPrice,ExecutePrice,TriggeredPrice,PositionDisposition,CreationDisposition,RejectionReason,ExchangeOrderId,PlatformOrderId\n";
  const ORDERS =
    H +
    "11,A,MNQZ6,Filled,Market,3,Bid,10/07/2026 16:20:37 +02:00,,10/07/2026 16:20:37 +02:00,,,,,31246.5,,Opening,Trader,,,\n" +
    "12,A,MNQZ6,Filled,Limit,3,Ask,10/07/2026 16:20:37 +02:00,,10/07/2026 17:49:06 +02:00,,,,31366.5,31366.5,,Closing,TakeProfit,,,\n" +
    "13,A,MNQZ6,Cancelled,Stop,3,Ask,10/07/2026 16:20:37 +02:00,,,10/07/2026 17:49:06 +02:00,,31227.5,,,,Undetermined,StopLoss,,,\n" +
    "21,A,MNQZ6,Filled,Market,3,Bid,10/08/2026 21:57:01 +02:00,,10/08/2026 21:57:01 +02:00,,,,,30969.75,,Opening,Trader,,,\n" +
    "22,A,MNQZ6,Cancelled,Stop,3,Ask,10/08/2026 21:57:01 +02:00,,,,,30969.75,,,,Undetermined,StopLoss,,,\n" +
    "23,A,MNQZ6,Cancelled,Limit,3,Ask,10/08/2026 21:57:01 +02:00,,,,,,31103,,,Undetermined,TakeProfit,,,\n" +
    "24,A,MNQZ6,Filled,Market,3,Ask,10/08/2026 21:58:21 +02:00,,10/08/2026 21:58:21 +02:00,,,,,30978.5,,Closing,Trader,,,\n";

  it("takes the target and an unmoved stop, and leaves a stop moved to the entry for the recording", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ImportWizard
        accounts={[ACCOUNT]}
        candidates={[]}
        instruments={[{ symbol: "MNQ", point_value: 2 }]}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [csvFile("trades.csv", TRADES), csvFile("orders.csv", ORDERS)]);
    expect(await screen.findByText(/Orders export — 7 orders/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reconcile/ }));
    expect(screen.getByText(/stop moved to the entry \(30969\.75\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Commit/ }));

    await vi.waitFor(() => expect(commitImportMock).toHaveBeenCalled());
    const [first, second] = commitImportMock.mock.calls[0][0].items;
    expect(first).toMatchObject({
      stop_price: 31227.5,
      target_price: 31366.5,
      final_stop_price: 31227.5,
      entry_order_type: "market",
      exit_kind: "target",
      stop_moved_to_profit: false,
    });
    expect(second).toMatchObject({
      stop_price: null,
      target_price: 31103,
      final_stop_price: 30969.75,
      exit_kind: "manual",
      stop_moved_to_profit: true,
    });
  });

  it("refuses the orders export on its own", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ImportWizard accounts={[ACCOUNT]} candidates={[]} />);
    await upload(user, csvFile("orders.csv", ORDERS));
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(expect.stringMatching(/goes with the trades export/)));
  });
});
