import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportWizard, type MatchCandidate } from "./import-wizard";
import type { Account } from "@/lib/journal/types";

/**
 * "Odbijene ćelije (nečitljivo: qty, fee) na ekranu, klasifikacija
 * create/merge/skip, i da se dvosmislen datum i `1,234` vide kao odbijeni a
 * ne kao pogođeni" — the plan's own stated goal for this step, verbatim.
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
  it("'1,234' (qty) and '02/03/2026' (entry time) both surface as nečitljivo", async () => {
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
    expect(within(row).getByText(/nečitljivo:/)).toHaveTextContent("qty");
    expect(within(row).getByText(/nečitljivo:/)).toHaveTextContent("entry time");
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
