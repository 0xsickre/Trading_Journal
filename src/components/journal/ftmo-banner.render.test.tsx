import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FtmoBanner } from "./ftmo-banner";
import type { Account } from "@/lib/journal/types";
import type { FtmoResult } from "@/lib/journal/ftmo";

// No `AppRouterContext` exists in jsdom, and `useRouter()` throws an invariant
// without one. The reset button's `router.refresh()` isn't under test here —
// the server action it calls is stubbed by the `server-only` alias anyway —
// so a bare no-op is enough to let the component render at all.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function account(over: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Prop",
    broker: null,
    currency: "USD",
    starting_balance: 100_000,
    default_asset_class: null,
    timezone: "UTC",
    is_active: true,
    breakeven_from: 0,
    breakeven_to: 0,
    breakeven_unit: "currency",
    default_commission_per_unit: 0,
    default_fee_fixed: 0,
    default_swap_per_day: 0,
    default_stop_pct: null,
    default_target_pct: null,
    ftmo_mode: true,
    ftmo_daily_loss_enabled: true,
    ftmo_daily_loss_pct: 5,
    ftmo_max_loss_enabled: true,
    ftmo_max_loss_pct: 10,
    ftmo_profit_target_enabled: true,
    ftmo_profit_target_pct: 10,
    ftmo_min_days_enabled: true,
    ftmo_min_days: 2,
    ftmo_reset_at: null,
    ...over,
  } as unknown as Account;
}

function result(over: Partial<FtmoResult>): FtmoResult {
  return {
    status: "active",
    breaches: [],
    netPnl: 0,
    profitPct: 0,
    currentEquity: 100_000,
    peakEquity: 100_000,
    maxDrawdownPct: 0,
    worstDay: null,
    daysTraded: 0,
    targetReached: false,
    minDaysMet: false,
    dailyLossLimit: null,
    maxLossFloor: null,
    profitTargetAmount: null,
    ...over,
  };
}

describe("FtmoBanner", () => {
  it("renders nothing when the mode is off", () => {
    const { container } = render(<FtmoBanner account={account()} result={result({ status: "off" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a failed challenge lists every breach with its amount and limit", () => {
    render(
      <FtmoBanner
        account={account()}
        result={result({
          status: "failed",
          breaches: [{ rule: "daily_loss", date: "2026-04-01", amount: -5200, limit: -5000 }],
        })}
      />,
    );
    expect(screen.getByText("Frozen")).toBeInTheDocument();
    expect(screen.getByText(/-\$5,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/limit -\$5,000\.00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset challenge/ })).toBeInTheDocument();
  });

  it("a passed challenge shows the profit target reached and days traded, no reset needed message", () => {
    render(
      <FtmoBanner
        account={account()}
        result={result({ status: "passed", profitPct: 10.4, daysTraded: 14 })}
      />,
    );
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getAllByText(/10\.4%/).length).toBeGreaterThan(0);
    expect(screen.getByText(/14 trading days/)).toBeInTheDocument();
  });

  it("an active challenge shows no reset button and flags insufficient trading days", () => {
    render(
      <FtmoBanner
        account={account()}
        result={result({ status: "active", daysTraded: 1, minDaysMet: false })}
      />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset challenge/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 \(not enough\)/)).toBeInTheDocument();
  });
});
