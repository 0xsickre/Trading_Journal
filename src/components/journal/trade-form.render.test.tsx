import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  // Ista valuta kao nalog, pa `resolveFxRate` daje 1 i preview pokazuje novac.
  // Kad se ove dve razlikuju a kurs nije poznat, forma NAMERNO ne prikazuje
  // iznose — vidi `fx.ts`. Zbog toga je ovo polje ovde load-bearing, ne dekor.
  quote_currency: "USD",
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

describe("plan vs realized, under 'How it exited'", () => {
  /**
   * The whole point of the line is that ONE null has three causes. These four
   * tests are one per state; if they ever collapse into "shows a percentage",
   * the distinction the component exists for has been lost.
   *
   * Asserted through `parentElement.textContent` rather than a single
   * `getByText`, because the realized half lives in its own coloured `<span>` —
   * so the sentence is split across elements by construction.
   */
  const line = (anchor: string) => screen.getByText(anchor).parentElement!;

  it("reads planned, realized and the percentage on a closed trade", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ executions: twoFillExecutions() })}
      />,
    );
    await goToExecutionTab(user);
    // The fixture targets 110 against a 10-point stop — a 1R plan — and the
    // exit fills at 120, so the trade BEAT its target. Over 100% is a real
    // reading, not an error, which is why nothing here clamps it.
    expect(line("2.00R realized").textContent).toBe(
      "Planned 1.00R → 2.00R realized · 200% of target",
    );
  });

  it("GRADES AGAINST THE STORED PLAN here too, not a live recompute", async () => {
    // Same trap as the metric above, one line below it: live geometry says
    // (200−100)/(100−90) = 10R, the stored plan says 2R. Reading
    // `metrics.plannedRR` instead of `plannedRewardFromTrade` would print
    // "Planned 10.00R" and reintroduce the defect a metric was already fixed for.
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
            target_price: "200",
            planned_rr: "1:2",
          },
          executions: twoFillExecutions(),
        })}
      />,
    );
    await goToExecutionTab(user);
    expect(line("2.00R realized").textContent).toBe(
      "Planned 2.00R → 2.00R realized · 100% of target",
    );
  });

  it("SAYS THE TRADE IS OPEN rather than showing it achieved nothing", async () => {
    // A missing realized R is not a zero. "—%" here would tell someone still
    // holding a position that they hit none of their target.
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({
          status: "open",
          executions: [
            {
              side: "entry",
              price: 100,
              qty: 1,
              executed_at: "2026-04-01T13:00:00Z",
              fee: 0,
              swap_funding: 0,
            },
          ],
        })}
      />,
    );
    await goToExecutionTab(user);
    expect(line("not closed yet").textContent).toBe(
      "Planned 1.00R → not closed yet",
    );
    expect(screen.queryByText(/of target/)).not.toBeInTheDocument();
  });

  it("shows both figures but NO percentage when the plan is too small to divide by", async () => {
    // Below MIN_PLANNED_REWARD_R the metric above hides entirely. The two R
    // figures are still true and still worth showing; only the ratio is not.
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
            planned_rr: "1:0.05",
          },
          executions: twoFillExecutions(),
        })}
      />,
    );
    await goToExecutionTab(user);
    expect(line("2.00R realized").textContent).toBe(
      "Planned 0.05R → 2.00R realized",
    );
    expect(screen.queryByText(/of target/)).not.toBeInTheDocument();
  });
});

describe("execution rating appears only where there is an execution to rate", () => {
  const stars = () => screen.queryByRole("radiogroup", { name: "Execution rating" });

  it("is offered on a closed trade", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ executions: twoFillExecutions() })}
      />,
    );
    await goToExecutionTab(user);
    expect(stars()).toBeInTheDocument();
  });

  it("IS NOT OFFERED ON A PLANNED TRADE, which has nothing to judge yet", async () => {
    // Rides the same gate that already drops `trade_journal_notes` from this
    // group rather than introducing a second name — a new name would have to be
    // taught to every predicate that defaults to "visible".
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned", executions: [] })}
      />,
    );
    await goToExecutionTab(user);
    expect(stars()).not.toBeInTheDocument();
  });

  it("is not offered on a missed setup either", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "missed", executions: [] })}
      />,
    );
    await goToExecutionTab(user);
    expect(stars()).not.toBeInTheDocument();
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

  it("ne prikazuje novac kad kurs kotacija→nalog nije poznat", async () => {
    // Instrument kotiran u jenima na dolarskom nalogu, bez snimljenog kursa.
    // Do 20260815130000 forma bi ovde ispisala bruto u JENIMA sa `$` ispred —
    // isti broj, pogrešna valuta, bez ijednog znaka da nešto ne valja.
    //
    // Očekivanje je odsustvo, ne nula: `resolveFxRate` vraća null, pa
    // `computePositionStats` ne računa novac, pa blok nema šta da iscrta.
    const user = userEvent.setup({ delay: null });
    const jpy = { ...INSTRUMENT, symbol: "USDJPY", quote_currency: "JPY" };
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[jpy]}
        accounts={[ACCOUNT]}
        initial={baseInitial({
          fields: { ...baseInitial().fields, instrument: "USDJPY" },
          executions: twoFillExecutions(5, 2),
        })}
      />,
    );
    await goToExecutionTab(user);

    expect(screen.queryByText("Gross → Net")).toBeNull();

    // R preživljava nepoznat kurs — odnos u prostoru cena ne traži valutu.
    // Da ovaj deo nestane zajedno sa novcem, izgubila bi se jedina brojka koja
    // je i dalje tačna.
    expect(screen.queryByText("Fees + Swap")).not.toBeNull();
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
    expect(screen.queryByRole("button", { name: /Mark as missed/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Mark as missed/ })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /Mark as missed/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Restore to planned/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move to active trade/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark as missed/ })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /Mark as missed/ }));
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

describe("the plan reveals one decision at a time", () => {
  /**
   * The regression this block exists for.
   *
   * `thesis`, `invalidation` and `time_stop_days` were appended to the
   * `risk_plan` group when they were added. `riskPlanFieldVisible` answers
   * `true` for any field name it does not recognise, so all three rendered on a
   * COMPLETELY BLANK form: Entry Price, and then three large textareas under it.
   * The progressive reveal exists precisely to stop that.
   */
  it("a blank form asks for the entry and nothing about the reasoning", async () => {
    render(
      <TradeForm optionsMap={{}} instruments={[INSTRUMENT]} accounts={[ACCOUNT]} />,
    );
    expect(screen.getByText("Planned Entry Price")).toBeInTheDocument();
    expect(screen.queryByText("Why this trade")).not.toBeInTheDocument();
    expect(screen.queryByText("Thesis")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Invalidation — what would prove me wrong"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Time stop (days)")).not.toBeInTheDocument();
  });

  it("the reasoning appears once entry and stop define a trade", async () => {
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned" })}
      />,
    );
    expect(screen.getByText("Why this trade")).toBeInTheDocument();
    expect(screen.getByText("Thesis")).toBeInTheDocument();
    expect(screen.getByText("Time stop (days)")).toBeInTheDocument();
  });

  /**
   * The time stop is five buttons, not a free number.
   *
   * Two things are asserted rather than one, and the second is the one that
   * matters: clicking the SAME value again clears it. Without that path back to
   * `null`, a mis-click would be permanent, and the journal would fill with time
   * stops nobody meant — the same reason `StarRating` and `TriButton` both
   * behave this way.
   */
  it("offers exactly 1..5 as buttons, and a mis-click can be taken back", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned" })}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Time stop (days)" });
    const days = within(group).getAllByRole("radio");
    expect(days.map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    // Nothing is preselected: "no time stop" is a real answer and must not be
    // spelled as "1 day".
    expect(days.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);

    await user.click(days[2]);
    expect(days[2]).toHaveAttribute("aria-checked", "true");

    await user.click(days[2]);
    expect(days[2]).toHaveAttribute("aria-checked", "false");
  });

  it("the scale-out plan waits for a target", async () => {
    // Two independent renders, not a rerender: `fields` is seeded from
    // `initial` by a useState INITIALISER, so new props never move it.
    const noTarget = render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({
          status: "planned",
          fields: { instrument: "EURUSD", entry_price: "100", stop_price: "90" },
        })}
      />,
    );
    expect(screen.queryByText("Scale-out plan")).not.toBeInTheDocument();
    noTarget.unmount();

    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned" })}
      />,
    );
    expect(screen.getByText("Scale-out plan")).toBeInTheDocument();
  });
});

describe("the risk is shown in money, not only as a percentage", () => {
  it("prints what the chosen percentage costs if the stop is hit", async () => {
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        accountEquity={{ "acc-1": 42_000 }}
        initial={baseInitial({
          status: "planned",
          fields: {
            instrument: "EURUSD",
            entry_price: "100",
            stop_price: "90",
            risk_pct: "1%",
          },
        })}
      />,
    );
    // 1 % of 42 000 equity. A percentage is easy to agree to; the figure is
    // what makes a trader re-check the stop.
    expect(screen.getByText(/Risking .*420/)).toBeInTheDocument();
  });

  it("WITHOUT A STOP it is a budget, not a loss — nothing can be 'hit' yet", async () => {
    // The blank-form bug: the note named the loss a stop would produce while no
    // stop had been entered. The figure itself was always right (a share of
    // equity), so the fix is the sentence around it, not the arithmetic.
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        accountEquity={{ "acc-1": 42_000 }}
        initial={baseInitial({
          status: "planned",
          fields: { instrument: "EURUSD", risk_pct: "1%" },
        })}
      />,
    );

    expect(screen.queryByText(/if the stop is hit/)).not.toBeInTheDocument();
    // Same number, honestly framed — the budget is still worth seeing early.
    expect(screen.getByText(/Risk budget .*420/)).toBeInTheDocument();
  });

  it("says nothing when no risk % has been chosen", async () => {
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        accountEquity={{ "acc-1": 42_000 }}
        initial={baseInitial({ status: "planned" })}
      />,
    );
    expect(screen.queryByText(/Risking/)).not.toBeInTheDocument();
  });
});

describe("one question, one place", () => {
  it("the Plan tab no longer carries a second free-text 'why'", async () => {
    // `trade_journal_notes` used to sit on this tab under "Why I am entering,
    // stop and target logic…", asking the same thing as Thesis two groups up.
    // It keeps the Execution tab, where the same column means the lesson AFTER
    // the outcome.
    render(
      <TradeForm
        optionsMap={{}}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        initial={baseInitial({ status: "planned" })}
      />,
    );
    expect(screen.getByText("Thesis")).toBeInTheDocument();
    expect(screen.queryByText("Trade note")).not.toBeInTheDocument();
  });
});

describe("the chart can be attached before the trade exists", () => {
  it("a new trade offers the two pre-entry snapshot slots", async () => {
    render(
      <TradeForm optionsMap={{}} instruments={[INSTRUMENT]} accounts={[ACCOUNT]} />,
    );
    expect(screen.getByText("HTF Pre")).toBeInTheDocument();
    expect(screen.getByText("LTF Pre")).toBeInTheDocument();
    // Not the post-exit slot: that is a screenshot of something that has not
    // happened.
    expect(screen.queryByText("LTF Post")).not.toBeInTheDocument();
  });

  it("keeps what is pasted, ready for the save", async () => {
    // The payload mapping itself is asserted in `trade-image-drafts.test.ts`.
    // Driving it through here would mean opening a Radix Select in jsdom to
    // satisfy the instrument check — a test that fails on the widget rather
    // than on the behaviour.
    const user = userEvent.setup({ delay: null });
    render(
      <TradeForm optionsMap={{}} instruments={[INSTRUMENT]} accounts={[ACCOUNT]} />,
    );
    const inputs = screen.getAllByPlaceholderText("https://www.tradingview.com/x/…");
    await user.type(inputs[0], "https://www.tradingview.com/x/AbC123/");
    expect(inputs[0]).toHaveValue("https://www.tradingview.com/x/AbC123/");
  });
});

describe("the playbook offers its risk, and never argues with you", () => {
  const BOOK = {
    id: "pb1",
    name: "ICT 2022",
    description: null,
    color: null,
    icon: null,
    is_active: true,
    sort_order: 0,
    default_risk_pct: 1,
    a_plus_criteria: "Sweep of a daily level, MSS with displacement",
    // A book with no sections and no rules — which is what a new playbook is.
    sections: [],
    rules: [],
  };
  const RISK_OPTIONS = {
    risk_pct: [
      { id: "o1", value: "0.5%", label: "0.5%", color: null, is_active: true, sort_order: 0 },
      { id: "o2", value: "1%", label: "1%", color: null, is_active: true, sort_order: 1 },
    ],
  } as never;

  // The "fills an empty field" half is asserted in plan-calculations.test.ts via
  // `matchRiskOption`. Driving it here would mean opening a Radix Select in
  // jsdom — a test that fails on the widget rather than on the behaviour.

  it("does NOT overwrite a risk % already chosen", async () => {
    // The whole contract. A deliberate 0.5 % on a marginal setup is the trader
    // overriding their own default; a prefill that replaced it would be the
    // form arguing with the person filling it in.
    render(
      <TradeForm
        optionsMap={RISK_OPTIONS}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        playbooks={[BOOK]}
        accountEquity={{ "acc-1": 42_000 }}
        initial={baseInitial({
          status: "planned",
          playbook_id: "pb1",
          fields: {
            instrument: "EURUSD",
            entry_price: "100",
            stop_price: "90",
            risk_pct: "0.5%",
          },
        })}
      />,
    );
    // 0.5 % of 42 000 = 210. If the playbook's 1 % had overwritten it, this
    // would read 420.
    expect(screen.getByText(/Risking .*210/)).toBeInTheDocument();
  });

  it("puts the playbook's A+ criterion in front of the setup grade", async () => {
    render(
      <TradeForm
        optionsMap={RISK_OPTIONS}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        playbooks={[BOOK]}
        initial={baseInitial({ status: "planned", playbook_id: "pb1" })}
      />,
    );
    expect(
      screen.getByText(/A\+ for ICT 2022: Sweep of a daily level/),
    ).toBeInTheDocument();
  });

  it("says nothing when the playbook has no A+ criterion", async () => {
    render(
      <TradeForm
        optionsMap={RISK_OPTIONS}
        instruments={[INSTRUMENT]}
        accounts={[ACCOUNT]}
        playbooks={[{ ...BOOK, a_plus_criteria: null }]}
        initial={baseInitial({ status: "planned", playbook_id: "pb1" })}
      />,
    );
    expect(screen.queryByText(/A\+ for/)).not.toBeInTheDocument();
  });
});
