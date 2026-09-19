import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSettings } from "./account-settings";
import type { Account } from "@/lib/journal/types";
import type { AccountUsage } from "@/lib/journal/account-usage";

/**
 * Deleting an account is the only click in this application that destroys trade
 * records and that import undo does not cover, so the guards are asserted where
 * the user meets them.
 *
 * The one that matters most is the third: a count that FAILED to read must take
 * the same careful path as a count that came back non-zero. `getAccountUsage`
 * returns -1 for a failed read precisely so `usageIsEmpty` answers false, and
 * that has to survive all the way to the button.
 */

const deleteAccountMock = vi.fn();
const countAccountUsageMock = vi.fn();
const updateAccountMock = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  updateAccount: (...a: unknown[]) => updateAccountMock(...a),
  addAccount: vi.fn(),
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
  ftmo_mode: false,
  ftmo_daily_loss_enabled: false,
  ftmo_daily_loss_pct: 0,
  ftmo_daily_loss_basis: "starting_balance",
  ftmo_max_loss_enabled: false,
  ftmo_max_loss_pct: 0,
  ftmo_profit_target_enabled: false,
  ftmo_profit_target_pct: 0,
  ftmo_min_days_enabled: false,
  ftmo_min_days: 0,
  ftmo_reset_at: null,
  ...over,
});

const usage = (o: Partial<AccountUsage> = {}): AccountUsage => ({
  trades: 0,
  cashEvents: 0,
  importBatches: 0,
  ...o,
});

const TWO = [account(), account({ id: "acc-2", name: "New Account" })];

/** The counts now arrive when the dialog opens, so each test states its own. */
const willCount = (u: AccountUsage) =>
  countAccountUsageMock.mockResolvedValue({ ok: true, usage: u });

beforeEach(() => {
  deleteAccountMock.mockReset();
  deleteAccountMock.mockResolvedValue({ ok: true });
  countAccountUsageMock.mockReset();
  willCount(usage());
});

describe("the last account cannot be deleted from the screen", () => {
  it("offers no Delete button when only one account exists", () => {
    render(
      <AccountSettings accounts={[account()]} />,
    );
    expect(
      screen.queryByRole("button", { name: /^Delete$/ }),
    ).not.toBeInTheDocument();
  });

  it("offers one per account once there are two", () => {
    render(
      <AccountSettings accounts={TWO} />,
    );
    expect(screen.getAllByRole("button", { name: /^Delete$/ })).toHaveLength(2);
  });
});

describe("an empty account is a tidy-up, a full one is a decision", () => {
  it("an empty account asks for no typing", async () => {
    const user = userEvent.setup();
    render(
      <AccountSettings accounts={TWO} />,
    );
    await user.click(screen.getAllByRole("button", { name: /^Delete$/ })[1]);

    expect(screen.getByText(/holds no trades/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Confirm account name"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete account/ }),
    ).toBeEnabled();
  });

  it("an account with trades prints the counts and locks the button", async () => {
    willCount(usage({ trades: 21, cashEvents: 2, importBatches: 1 }));
    const user = userEvent.setup();
    render(
      <AccountSettings accounts={TWO} />,
    );
    await user.click(screen.getAllByRole("button", { name: /^Delete$/ })[0]);

    // The numbers are the point of the dialog: "delete account?" cannot be
    // answered honestly without them.
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: /Delete account/ });
    expect(confirm).toBeDisabled();

    const box = screen.getByLabelText("Confirm account name");
    await user.type(box, "Main Accoun");
    expect(confirm).toBeDisabled();

    await user.type(box, "t");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(deleteAccountMock).toHaveBeenCalledWith("acc-1", "Main Account");
  });

  it("a count that failed to read takes the careful path, not the empty one", async () => {
    // -1 is the sentinel getAccountUsage returns for a failed count.
    willCount(usage({ trades: -1, cashEvents: -1, importBatches: -1 }));
    const user = userEvent.setup();
    render(
      <AccountSettings accounts={TWO} />,
    );
    await user.click(screen.getAllByRole("button", { name: /^Delete$/ })[0]);

    expect(screen.getByText(/could not be counted/)).toBeInTheDocument();
    // Crucially NOT the "holds no trades" wording, and still gated on typing.
    expect(screen.queryByText(/holds no trades/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete account/ })).toBeDisabled();
  });

  it("a count that never comes back is treated as unknown, not empty", async () => {
    // The state the dialog is in for its first frame, every time: asked, not
    // yet answered. It must read as "unknown", never as "empty".
    countAccountUsageMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<AccountSettings accounts={TWO} />);
    await user.click(screen.getAllByRole("button", { name: /^Delete$/ })[0]);

    expect(screen.getByText(/could not be counted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete account/ })).toBeDisabled();
  });
});

describe("backtest or trading — where MAE/MFE comes from", () => {
  it("a trading account says MT5", () => {
    render(<AccountSettings accounts={[account({ account_kind: "trading" })]} />);
    expect(screen.getByText(/filled from your MT5 terminal/)).toBeInTheDocument();
  });

  it("a backtest account says MAE/MFE comes from the TradingView import", () => {
    render(<AccountSettings accounts={[account({ account_kind: "backtest" })]} />);
    expect(screen.getByText(/from TradingView's own excursions/)).toBeInTheDocument();
  });

  it("the type is saved with the account", async () => {
    updateAccountMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    render(<AccountSettings accounts={[account({ account_kind: "trading" })]} />);
    await user.click(screen.getByRole("combobox", { name: "Account type" }));
    await user.click(await screen.findByRole("option", { name: /Backtest/ }));
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(updateAccountMock).toHaveBeenCalledWith(
      "acc-1",
      expect.objectContaining({ account_kind: "backtest" }),
    );
  });
});
