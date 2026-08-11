import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeForm, type TradeFormInitial } from "./trade-form";
import type { Account, Instrument } from "@/lib/journal/types";

/**
 * Tier 1 per the phase plan: the biggest useMemo in the app after
 * `dashboard.tsx`, and the plan named two specific candidates in advance —
 * a second, looser implementation of target attainment (`:438`), and
 * `grossPl - netPl` computed in JSX where `metrics.fees` already exists
 * (`:1024`). One of those was real; the other, checked against the algebra
 * in `position-stats.ts`, was not — see the two describe blocks below.
 *
 * Also covered: the lifecycle-button gating this file's own history already
 * got wrong once (commit `dd5a079`, "a button that is shown and cannot work
 * is worse than no button") — this is the regression guard for that fix.
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

const createTradeMock = vi.fn();
const updateTradeMock = vi.fn();
const markTradeMissedMock = vi.fn();
const restoreTradeToPlannedMock = vi.fn();
vi.mock("@/app/(app)/trades/actions", () => ({
  createTrade: (...a: unknown[]) => createTradeMock(...a),
  updateTrade: (...a: unknown[]) => updateTradeMock(...a),
  markTradeMissed: (...a: unknown[]) => markTradeMissedMock(...a),
  restoreTradeToPlanned: (...a: unknown[]) => restoreTradeToPlannedMock(...a),
}));

// `TradeImages` (rendered whenever `initial` is set) hits Supabase directly
// on mount, not through a Server Action — stub the client so `.from(...)`
// resolves to an empty list instead of reaching a real project.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
  }),
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

const INSTRUMENT: Instrument = {
  id: "i1",
  symbol: "EURUSD",
  name: null,
  asset_class: "forex",
  point_value: 1,
  tick_size: null,
  tick_value: null,
  currency: "USD",
  is_active: true,
  sort_order: 0,
} as unknown as Instrument;

const ACCOUNT = account({ id: "acc-1" });

/** Two fills — entry 100 → exit 120, point value 1 — a deterministic 2.00R
 *  win (`realized_r = grossPoints / (riskPts × entryQty) = 20 / (10 × 1)`).
 *  `fee`/`swap` default to 0 unless overridden. */
function twoFillExecutions(fee = 0, swap = 0): TradeFormInitial["executions"] {
  return [
    { side: "entry", price: 100, qty: 1, executed_at: "2026-04-01T13:00:00Z", fee: 0, swap_funding: 0 },
    { side: "exit", price: 120, qty: 1, executed_at: "2026-04-02T13:00:00Z", fee, swap_funding: swap },
  ];
}

function baseInitial(over: Partial<TradeFormInitial> = {}): TradeFormInitial {
  return {
    id: "t1",
    account_id: "acc-1",
    trade_no: 1,
    status: "closed",
    fields: {
      instrument: "EURUSD",
      direction: "Long",
      entry_price: "100",
      stop_price: "90",
      target_price: "110",
    },
    executions: [],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
  createTradeMock.mockReset().mockResolvedValue({ ok: true });
  updateTradeMock.mockReset().mockResolvedValue({ ok: true });
});

async function goToExecutionTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /Execution/ }));
}

describe("target attainment (W4 — a second, looser implementation)", () => {
  it("a stored planned reward below the 0.1R floor hides the metric, matching exit-efficiency.ts", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({
          fields: {
            instrument: "EURUSD",
            direction: "Long",
            entry_price: "100",
            stop_price: "90",
            target_price: "110",
            planned_rr: "1:0.05", // 0.05R — below MIN_PLANNED_REWARD_R (0.1)
          },
          executions: twoFillExecutions(),
        })}
      />,
    );
    await goToExecutionTab(user);
    expect(screen.queryByText("Target attainment")).not.toBeInTheDocument();
  });

  it("grades against the STORED plan, not a live recompute from edited price fields", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({
          fields: {
            instrument: "EURUSD",
            direction: "Long",
            entry_price: "100",
            stop_price: "90",
            // Live geometry implies a reward of (200−100)/(100−90) = 10R —
            // wildly different from the 2R that was actually planned and
            // stored. Before the fix, this field's live value silently
            // became the grading baseline.
            target_price: "200",
            planned_rr: "1:2",
          },
          executions: twoFillExecutions(),
        })}
      />,
    );
    await goToExecutionTab(user);

    const metric = screen.getByText("Target attainment").closest("div")!;
    // realizedR 2.00 / STORED plannedRewardR 2.00 = 100%, not 2.00/10.00 = 20%.
    expect(metric).toHaveAttribute(
      "title",
      expect.stringContaining("2.00R realized / 2.00R planned target"),
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("Gross → Net (rejected candidate, verified correct — not W)", () => {
  it("grossPl − netPl always equals Fees + Swap, by construction of net_pl in position-stats.ts", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ executions: twoFillExecutions(5, 2) })}
      />,
    );
    await goToExecutionTab(user);

    // fees(5) + swap(2) = $7.00; gross(20) − net(13) = $7.00 — same string,
    // by the algebra `net_pl = gross_pl − total_fees − total_swap`.
    const feesLabel = screen.getByText("Fees + Swap").closest("div")!;
    const grossToNetLabel = screen.getByText("Gross → Net").closest("div")!;
    expect(feesLabel.textContent).toContain("$7.00");
    expect(grossToNetLabel.textContent).toContain("$7.00");
  });
});

describe("lifecycle buttons only appear where the action can actually succeed", () => {
  async function goToPlanTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: /Plan & Setup/ }));
  }

  it("an unsaved (new) trade shows none of the three buttons", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm optionsMap={{}} instruments={[INSTRUMENT]} accounts={[ACCOUNT]} />);
    await goToPlanTab(user);
    expect(screen.queryByRole("button", { name: /Move to active trade/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Označi kao miss/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vrati u planned/ })).not.toBeInTheDocument();
  });

  it("a saved planned trade with no fills offers Move to active and Mark missed, not Restore", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned", executions: [] })}
      />,
    );
    await goToPlanTab(user);
    expect(screen.getByRole("button", { name: /Move to active trade/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Označi kao miss/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vrati u planned/ })).not.toBeInTheDocument();
  });

  it("a trade with a valid entry fill is already active — none of the three buttons apply", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "open", executions: twoFillExecutions() })}
      />,
    );
    await goToPlanTab(user);
    expect(screen.queryByRole("button", { name: /Move to active trade/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Označi kao miss/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vrati u planned/ })).not.toBeInTheDocument();
  });

  it("a missed trade offers only Restore to planned", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "missed", executions: [] })}
      />,
    );
    await goToPlanTab(user);
    expect(screen.getByRole("button", { name: /Vrati u planned/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move to active trade/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Označi kao miss/ })).not.toBeInTheDocument();
  });

  it("clicking Mark missed on the one state that offers it actually succeeds, not just shows", async () => {
    const user = userEvent.setup({ delay: null });
    markTradeMissedMock.mockResolvedValue({ ok: true });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned", executions: [] })}
      />,
    );
    await goToPlanTab(user);
    await user.click(screen.getByRole("button", { name: /Označi kao miss/ }));
    expect(markTradeMissedMock).toHaveBeenCalledWith("t1", expect.anything());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});

describe("FTMO-frozen account blocks a new trade before anything else is validated", () => {
  it("disables Save trade outright — the reader cannot even attempt the submit", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        ftmoFailedAccountIds={["acc-1"]}
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /Save trade/ });
    expect(saveBtn).toBeDisabled();

    await user.click(saveBtn); // a disabled button fires no click handler
    expect(createTradeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("editing an ALREADY-SAVED trade on a frozen account stays allowed", async () => {
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        ftmoFailedAccountIds={["acc-1"]}
        initial={baseInitial({ status: "planned", executions: [] })}
      />,
    );
    // Freezing blocks NEW trades only — an existing one must stay editable,
    // or a trader could never even correct a typo on a frozen account.
    expect(screen.getByRole("button", { name: /Update trade/ })).toBeEnabled();
  });
});
