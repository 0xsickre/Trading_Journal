import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashEventsManager } from "./cash-events-manager";
import type { Account } from "@/lib/journal/types";
import type { CashEvent } from "@/lib/journal/balance";

/**
 * The deposits list as the trader reads it: the starting balance as its first
 * entry (derived, not deletable), dates in the account's zone as dd/MM/yyyy,
 * no new entries on an archived account, and no delete without a confirmation.
 */

const addCashEventMock = vi.fn();
const deleteCashEventMock = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  addCashEvent: (...a: unknown[]) => addCashEventMock(...a),
  deleteCashEvent: (...a: unknown[]) => deleteCashEventMock(...a),
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
  ftmo_daily_loss_basis: "starting_balance",
  ftmo_max_loss_enabled: false,
  ftmo_max_loss_pct: 0,
  ftmo_profit_target_enabled: false,
  ftmo_profit_target_pct: 0,
  ftmo_min_days_enabled: false,
  ftmo_min_days: 0,
  ftmo_reset_at: null,
  archived_at: null,
  created_at: "2026-01-05T15:00:00Z",
  ...over,
});

const EUR = account({
  id: "acc-2",
  name: "EUR book",
  currency: "EUR",
  starting_balance: 0,
  is_active: false,
  timezone: "Europe/Berlin",
});
const OLD = account({ id: "acc-3", name: "Old challenge", is_active: false, archived_at: "2026-08-01T00:00:00Z" });

const EVENTS: CashEvent[] = [
  {
    id: "ev-1",
    account_id: "acc-1",
    event_type: "withdrawal",
    amount: -2_000,
    // 02:00 UTC on the 1st is still the 31st in New York.
    occurred_at: "2026-04-01T02:00:00Z",
    note: "Rent",
  },
  { id: "ev-2", account_id: "acc-2", event_type: "deposit", amount: 500, occurred_at: "2026-03-10T12:00:00Z", note: null },
];

beforeEach(() => {
  addCashEventMock.mockReset().mockResolvedValue({ ok: true });
  deleteCashEventMock.mockReset().mockResolvedValue({ ok: true });
});

describe("the history", () => {
  it("opens with the starting balance, read-only", () => {
    render(<CashEventsManager accounts={[account()]} events={[]} />);
    const row = screen.getByText("Opening balance").closest("tr")!;
    expect(within(row).getByText("$100,000.00")).toBeInTheDocument();
    expect(within(row).getByText("05/01/2026")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("dates entries in the account's zone as dd/MM/yyyy", () => {
    render(<CashEventsManager accounts={[account()]} events={EVENTS.slice(0, 1)} />);
    const row = screen.getByText("Rent").closest("tr")!;
    expect(within(row).getByText("31/03/2026")).toBeInTheDocument();
  });

  it("sums the net flow per currency, never across them, and leaves the opening out", () => {
    render(<CashEventsManager accounts={[account(), EUR]} events={EVENTS} />);
    expect(screen.getByText("-$2,000.00", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/\+€500\.00|\+500\.00 €/, { selector: "span" })).toBeInTheDocument();
  });

  it("filters by account", async () => {
    const user = userEvent.setup({ delay: null });
    render(<CashEventsManager accounts={[account(), EUR]} events={EVENTS} />);
    await user.click(screen.getByRole("combobox", { name: "Filter by account" }));
    await user.click(await screen.findByRole("option", { name: "EUR book" }));
    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
    expect(screen.queryByText("Opening balance")).not.toBeInTheDocument();
    expect(screen.getByText("Deposit", { selector: "td" })).toBeInTheDocument();
  });
});

describe("new entries", () => {
  it("does not offer an archived account", async () => {
    const user = userEvent.setup({ delay: null });
    render(<CashEventsManager accounts={[account(), OLD]} events={[]} />);
    await user.click(screen.getByLabelText("Account"));
    expect(screen.queryByRole("option", { name: "Old challenge" })).not.toBeInTheDocument();
  });

  it("refuses an ambiguous amount inline and records a clear one at midday in the account's zone", async () => {
    const user = userEvent.setup({ delay: null });
    render(<CashEventsManager accounts={[account()]} events={[]} />);
    const amount = screen.getByLabelText(/Amount/);
    await user.type(amount, "1.500");
    expect(screen.getByText(/Ambiguous/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add/ })).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, "1500");
    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-03-02");
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await vi.waitFor(() =>
      expect(addCashEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: "acc-1",
          event_type: "deposit",
          amount: 1500,
          // 12:00 in New York (EST, UTC−5).
          occurred_at: "2026-03-02T17:00:00.000Z",
        }),
      ),
    );
  });
});

describe("delete", () => {
  it("asks first, naming the entry", async () => {
    const user = userEvent.setup({ delay: null });
    render(<CashEventsManager accounts={[account()]} events={EVENTS.slice(0, 1)} />);
    await user.click(screen.getByRole("button", { name: /Delete withdrawal of 31\/03\/2026/ }));
    expect(deleteCashEventMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Withdrawal of -\$2,000\.00 on 31\/03\/2026/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteCashEventMock).toHaveBeenCalledWith("ev-1"));
  });
});
