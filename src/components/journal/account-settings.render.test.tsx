import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSettings } from "./account-settings";
import type { Account } from "@/lib/journal/types";
import type { AccountUsage } from "@/lib/journal/account-usage";

/**
 * Deleting an account is the only click in this application that destroys trade
 * records and that import undo does not cover, so its guards are asserted where
 * the user meets them — including the one that matters most: a count that FAILED
 * to read takes the same careful path as a count that came back non-zero.
 *
 * Around it, the compact list: archive and restore, duplicate, a new-account
 * dialog, and an edit dialog that refuses a number it cannot read.
 */

const deleteAccountMock = vi.fn();
const countAccountUsageMock = vi.fn();
const updateAccountMock = vi.fn();
const addAccountMock = vi.fn();
const archiveAccountMock = vi.fn();
const restoreAccountMock = vi.fn();
const resetTopstepAccountMock = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  updateAccount: (...a: unknown[]) => updateAccountMock(...a),
  addAccount: (...a: unknown[]) => addAccountMock(...a),
  archiveAccount: (...a: unknown[]) => archiveAccountMock(...a),
  restoreAccount: (...a: unknown[]) => restoreAccountMock(...a),
  resetTopstepAccount: (...a: unknown[]) => resetTopstepAccountMock(...a),
  deleteAccount: (...a: unknown[]) => deleteAccountMock(...a),
  countAccountUsage: (...a: unknown[]) => countAccountUsageMock(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const account = (over: Partial<Account> = {}): Account => ({
  id: "acc-1",
  name: "Main Account",
  broker: null,
  account_kind: "trading",
  currency: "USD",
  starting_balance: 100_000,
  default_asset_class: null,
  timezone: "Europe/Berlin",
  is_active: true,
  breakeven_from: 0,
  breakeven_to: 0,
  breakeven_unit: "currency",
  default_commission_per_unit: 0,
  default_fee_fixed: 0,
  default_swap_per_day: 0,
  default_stop_pct: null,
  default_target_pct: null,


  topstep_mode: false,

  topstep_plan: "50K" as const,

  topstep_payout_at: null,

  topstep_reset_at: null,

  risk_rule_pct: 12.5,

  risk_rule_min: null,

  risk_rule_max: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const usage = (o: Partial<AccountUsage> = {}): AccountUsage => ({
  trades: 0,
  cashEvents: 0,
  importBatches: 0,
  ...o,
});

const TWO = [account(), account({ id: "acc-2", name: "Combine 2", is_active: false })];

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
}

beforeEach(() => {
  for (const m of [
    deleteAccountMock,
    updateAccountMock,
    addAccountMock,
    archiveAccountMock,
    restoreAccountMock,
    resetTopstepAccountMock,
  ])
    m.mockReset().mockResolvedValue({ ok: true });
  countAccountUsageMock.mockReset();
});

describe("the list", () => {
  it("shows one compact row per account, with its type, balance and trades", () => {
    render(<AccountSettings accounts={TWO} tradeCounts={{ "acc-1": 12, "acc-2": null }} />);
    const row = screen.getByText("Main Account").closest("tr")!;
    expect(within(row).getByText("Live")).toBeInTheDocument();
    expect(within(row).getByText("Default")).toBeInTheDocument();
    expect(within(row).getByText("$100,000.00")).toBeInTheDocument();
    expect(within(row).getByText("12")).toBeInTheDocument();
    // A failed count is a dash, never 0.
    const other = screen.getByText("Combine 2").closest("tr")!;
    expect(within(other).getByTitle("Count unavailable")).toBeInTheDocument();
  });

  it("folds archived accounts away under their own heading", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <AccountSettings
        accounts={[...TWO, account({ id: "acc-3", name: "Old challenge", archived_at: "2026-08-01T00:00:00Z" })]}
      />,
    );
    expect(screen.queryByText("Old challenge")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Archived \(1\)/ }));
    expect(screen.getByText("Old challenge")).toBeInTheDocument();
  });
});

describe("archive and restore", () => {
  it("archives from the menu", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} />);
    await openMenu(user, "Combine 2");
    await user.click(await screen.findByRole("menuitem", { name: /Archive/ }));
    await vi.waitFor(() => expect(archiveAccountMock).toHaveBeenCalledWith("acc-2"));
  });

  it("does not offer to archive the only account left", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={[account()]} />);
    await openMenu(user, "Main Account");
    expect(await screen.findByRole("menuitem", { name: /Archive/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("restores an archived account", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <AccountSettings accounts={[account(), account({ id: "acc-3", name: "Old", archived_at: "2026-08-01T00:00:00Z" })]} />,
    );
    await user.click(screen.getByRole("button", { name: /Archived \(1\)/ }));
    await openMenu(user, "Old");
    await user.click(await screen.findByRole("menuitem", { name: /Restore/ }));
    await vi.waitFor(() => expect(restoreAccountMock).toHaveBeenCalledWith("acc-3"));
  });
});

describe("new account and duplicate", () => {
  it("creates an account from the dialog with its type, currency, balance and timezone", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} />);
    await user.click(screen.getByRole("button", { name: /New account/ }));
    await user.type(screen.getByLabelText("Name"), "Swing live");
    await user.type(screen.getByLabelText("Starting balance"), "25000");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() =>
      expect(addAccountMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Swing live",
          account_kind: "trading",
          currency: "USD",
          starting_balance: 25000,
          copyFrom: null,
        }),
      ),
    );
  });

  it("duplicate prefills the dialog and copies from the source", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} />);
    await openMenu(user, "Combine 2");
    await user.click(await screen.findByRole("menuitem", { name: /Duplicate/ }));
    expect(screen.getByLabelText("Name")).toHaveValue("Combine 2 (copy)");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() =>
      expect(addAccountMock).toHaveBeenCalledWith(expect.objectContaining({ copyFrom: "acc-2" })),
    );
  });

  it("says a duplicate copies the Topstep rules — FTMO is gone (H1)", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} />);
    await openMenu(user, "Combine 2");
    await user.click(await screen.findByRole("menuitem", { name: /Duplicate/ }));
    expect(screen.getByText(/costs and Topstep rules/)).toBeInTheDocument();
    expect(screen.queryByText(/FTMO/)).not.toBeInTheDocument();
  });
});

describe("edit", () => {
  it("names a number it cannot read and blocks the save", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} tradeCounts={{ "acc-1": 0 }} />);
    await openMenu(user, "Main Account");
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const balance = screen.getByLabelText("Starting balance");
    await user.clear(balance);
    await user.type(balance, "abc");
    expect(screen.getByText("Not a number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it("locks the currency once the account has trades", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} tradeCounts={{ "acc-1": 5 }} />);
    await openMenu(user, "Main Account");
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect(screen.getByLabelText("Currency")).toBeDisabled();
    expect(screen.getByText(/Locked: the trades on this account/)).toBeInTheDocument();
  });

  it("saves the type with the account", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={TWO} tradeCounts={{ "acc-1": 0 }} />);
    await openMenu(user, "Main Account");
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    // A live account: MT5 is gone (H1) — its MAE/MFE comes from R2.
    expect(screen.getByText(/from the exchange's candles \(R2\)/)).toBeInTheDocument();
    expect(screen.queryByText(/MT5/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Type"));
    await user.click(await screen.findByRole("option", { name: "Backtest" }));
    expect(screen.getByText(/from the TradingView import/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(updateAccountMock).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({ account_kind: "backtest", starting_balance: 100000 }),
      ),
    );
  });
});

describe("FTMO is gone (H1, 28.09.2026)", () => {
  it("the edit dialog offers Topstep rules and no FTMO challenge", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={[account()]} tradeCounts={{ "acc-1": 0 }} />);
    await openMenu(user, "Main Account");
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect(screen.getByText("Topstep rules (futures)")).toBeInTheDocument();
    expect(screen.queryByText(/FTMO/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restart challenge/ })).not.toBeInTheDocument();
  });

  it("the list names a Topstep account's plan in the Rules column", () => {
    render(<AccountSettings accounts={[account({ topstep_mode: true })]} />);
    expect(screen.getByText("Topstep 50K")).toBeInTheDocument();
  });
});

describe("a Topstep account can be reset", () => {
  // A plan on a Topstep account past its MLL is refused until the account is
  // reset, so the reset has to exist where the refusal points: here.
  it("offers Reset account… and writes the reset only after the confirmation", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={[account({ topstep_mode: true })]} tradeCounts={{ "acc-1": 3 }} />);
    await openMenu(user, "Main Account");
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    await user.click(screen.getByRole("button", { name: /Reset account/ }));
    expect(resetTopstepAccountMock).not.toHaveBeenCalled();
    expect(screen.getByText(/stop counting toward the Topstep limits/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await vi.waitFor(() => expect(resetTopstepAccountMock).toHaveBeenCalledWith("acc-1"));
  });

  it("is not offered on an account outside Topstep mode", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={[account()]} tradeCounts={{ "acc-1": 3 }} />);
    await openMenu(user, "Main Account");
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect(screen.queryByRole("button", { name: /Reset account/ })).not.toBeInTheDocument();
  });
});

describe("delete permanently", () => {
  async function openDelete(user: ReturnType<typeof userEvent.setup>, u: AccountUsage) {
    countAccountUsageMock.mockResolvedValue({ ok: true, usage: u });
    render(<AccountSettings accounts={TWO} />);
    await openMenu(user, "Combine 2");
    await user.click(await screen.findByRole("menuitem", { name: /Delete permanently/ }));
  }

  it("an empty account asks for no typing", async () => {
    const user = userEvent.setup({ delay: null });
    await openDelete(user, usage());
    const button = await screen.findByRole("button", { name: /Delete permanently/ });
    await vi.waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByLabelText(/to confirm/)).not.toBeInTheDocument();
    await user.click(button);
    await vi.waitFor(() => expect(deleteAccountMock).toHaveBeenCalledWith("acc-2", ""));
  });

  it("an account with trades prints the counts and locks the button until the name is typed", async () => {
    const user = userEvent.setup({ delay: null });
    await openDelete(user, usage({ trades: 7, cashEvents: 2, importBatches: 1 }));
    expect(await screen.findByText("7")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Delete permanently/ });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), "Combine 2");
    expect(button).toBeEnabled();
  });

  it("a count that failed to read takes the careful path, not the empty one", async () => {
    const user = userEvent.setup({ delay: null });
    await openDelete(user, usage({ trades: -1 }));
    expect(await screen.findByText(/could not be counted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete permanently/ })).toBeDisabled();
  });

  it("a count that never comes back keeps the button locked", async () => {
    const user = userEvent.setup({ delay: null });
    countAccountUsageMock.mockReturnValue(new Promise(() => {}));
    render(<AccountSettings accounts={TWO} />);
    await openMenu(user, "Combine 2");
    await user.click(await screen.findByRole("menuitem", { name: /Delete permanently/ }));
    expect(await screen.findByRole("button", { name: /Delete permanently/ })).toBeDisabled();
    expect(screen.getAllByText(/Checking what this account holds/).length).toBeGreaterThan(0);
  });
});
