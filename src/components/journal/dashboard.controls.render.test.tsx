import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "./dashboard";
import { mkTrade } from "@/lib/journal/reports/test-helpers";
import type { Account, TradeRow } from "@/lib/journal/types";
import type { RealizedTrade } from "@/lib/journal/analytics";

/**
 * THE CONTROLS, NOT JUST THE NUMBERS.
 *
 * Step 1 rendered one fixed book and asserted the figures it produces. This
 * file exercises the state a reader actually touches — period, account,
 * net/gross — because `P1` did not live in a formula, it lived in what the
 * period BUTTON did when clicked: `cutoffMs` used to read `new Date()`, so the
 * "last 90 days" a trader saw depended on the timezone their BROWSER happened
 * to be in and the SECOND they happened to load the page.
 *
 * `ResponsiveContainer` is mocked exactly as in step 1, for the same reason.
 */

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

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

const rowsOf = (trades: RealizedTrade[]): TradeRow[] => trades.map((t) => t.row);

/** The account-filter trigger, specifically. The page renders more than one
 *  Radix Select (account filter, granularity, "Performance by tag" breakdown
 *  field all carry `role="combobox"`), and `{ name }` can't disambiguate
 *  them: per the ARIA accname spec a combobox's visible text is its VALUE,
 *  not its NAME, so `getByRole("combobox", { name: ... })` finds nothing at
 *  all here — confirmed empirically, every trigger's computed name is `""`.
 *  Scope by DOM proximity to the visible "All accounts" text instead. */
function accountSelect(): HTMLElement {
  return screen.getByText("All accounts").closest('[role="combobox"]')!;
}

/** The value shown in the KPI tile labelled `label` — see step 1 for why the
 *  `data-slot="card-content"` scope is needed (the same word appears twice
 *  on this page: once as a tile, once as a table column header). */
function statValue(label: string): string {
  const labelEl = screen
    .getAllByText(label)
    .find((el) => el.parentElement?.getAttribute("data-slot") === "card-content");
  return labelEl?.parentElement?.children[1]?.textContent ?? "";
}

describe("the period buttons read the account's day, never the browser's clock", () => {
  /**
   * Ten trades spanning 2–13 March 2026, same shape as `book.fixture.ts`'s
   * book but built here so the cutoff can be placed deliberately mid-book:
   * `todayKey = 2026-04-05` puts the 30-day cutoff at the account-zone start
   * of 2026-03-07, splitting the book 5/5 — trades 1–5 fall before it, 6–10
   * land on or after it. A period wide enough to cover the whole book (90d,
   * the default) would never show a boundary at all.
   */
  const NET = [300, -100, 200, -50, 150, -200, 400, -150, 0, 50];
  const CLOSE_DAYS = [
    "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
    "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13",
  ];
  const TODAY_KEY = "2026-04-05";
  const ACCOUNT = account({ id: "acc-1" });

  const book = NET.map((net, i) =>
    mkTrade({ id: `c${i}`, net, closedAt: `${CLOSE_DAYS[i]}T18:00:00Z` }),
  );

  function renderAt(systemTime: string) {
    vi.setSystemTime(new Date(systemTime));
    return render(
      <Dashboard
        trades={rowsOf(book)}
        accounts={[ACCOUNT]}
        todayKey={TODAY_KEY}
        timezone={ACCOUNT.timezone}
      />,
    );
  }

  // `vi.setSystemTime` mocks `Date` on its own — it does not need (and must
  // not be paired with) `vi.useFakeTimers()`. That combination looked like
  // the obvious way to fix "wall clock" and "userEvent" both at once, but it
  // deadlocks: `@testing-library/user-event` v14 schedules its own internal
  // waits, and even with `advanceTimers` wired to `vi.advanceTimersByTime`,
  // a plain `userEvent.click()` on a bare `<button>` hangs to the 5000ms
  // test timeout with fake timers installed — confirmed in isolation,
  // stripped down to no Dashboard, no Radix, no recharts. Real timers plus a
  // mocked `Date` gives every assertion below the exact same account-zone
  // cutoff without that deadlock.
  afterEach(() => vi.useRealTimers());

  it("defaults to 90d, which covers the whole book", () => {
    renderAt("2026-04-05T12:00:00Z");
    expect(statValue("Trades")).toBe("10");
    // 300−100+200−50+150−200+400−150+0+50 = 600, same total step 1 proved.
    expect(statValue("Net P/L")).toBe("+$600.00");
  });

  it("30d excludes exactly the trades before the account-zone cutoff", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("2026-04-05T12:00:00Z");

    await user.click(screen.getByRole("button", { name: "30d" }));

    // Trades 6–10 only: −200+400−150+0+50 = 100.
    expect(statValue("Trades")).toBe("5");
    expect(statValue("Net P/L")).toBe("+$100.00");
  });

  it("gives the IDENTICAL 30d window at 00:05 and at 23:55 UTC", async () => {
    // The regression `P1` actually was: the window used to slide with the
    // clock. Two renders, two wildly different wall-clock instants, same
    // `todayKey` prop — if anything in this tree still reads `Date.now()`
    // for the money window, one of these two numbers moves and the test
    // catches it.
    const user1 = userEvent.setup({ delay: null });
    const first = renderAt("2026-04-05T00:05:00Z");
    await user1.click(screen.getByRole("button", { name: "30d" }));
    const early = statValue("Net P/L");
    first.unmount();

    const user2 = userEvent.setup({ delay: null });
    renderAt("2026-04-05T23:55:00Z");
    await user2.click(screen.getByRole("button", { name: "30d" }));
    const late = statValue("Net P/L");

    expect(early).toBe("+$100.00");
    expect(late).toBe("+$100.00");
    expect(early).toBe(late);
  });
});

describe("net / gross changes which side of a trade counts", () => {
  /**
   * One trade a big fee turned into a net loser despite a genuine gross win —
   * `net: -10, gross: 50` — so the two modes classify it on OPPOSITE sides of
   * the breakeven band. `Net P/L` and `Gross P/L` are always both shown and
   * always both read `stats.netSum` / `stats.grossSum`, mode or no mode — the
   * distinction under test is which one WIN-RATE, BEST and WORST follow.
   */
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [
    mkTrade({ id: "fee-eaten", net: -10, gross: 50, closedAt: "2026-05-01T18:00:00Z" }),
    mkTrade({ id: "clean-win", net: 40, gross: 40, closedAt: "2026-05-02T18:00:00Z" }),
  ];

  function renderIt() {
    return render(
      <Dashboard
        trades={rowsOf(trades)}
        accounts={[ACCOUNT]}
        todayKey="2026-05-02"
        timezone={ACCOUNT.timezone}
      />,
    );
  }

  it("net mode: the fee-eaten trade counts as the loss", () => {
    renderIt();
    expect(statValue("Win rate")).toBe("50.0%");
    expect(statValue("Best")).toBe("+$40.00");
    expect(statValue("Worst")).toBe("-$10.00");
    // Unaffected by mode — always the raw sums.
    expect(statValue("Net P/L")).toBe("+$30.00");
    expect(statValue("Gross P/L")).toBe("+$90.00");
  });

  it("gross mode: the SAME trade counts as a win", async () => {
    const user = userEvent.setup({ delay: null });
    renderIt();

    await user.click(screen.getByRole("button", { name: "gross" }));

    expect(statValue("Win rate")).toBe("100.0%");
    expect(statValue("Best")).toBe("+$50.00");
    expect(statValue("Worst")).toBe("+$40.00");
    // Still the same raw sums — mode changes CLASSIFICATION, not these two.
    expect(statValue("Net P/L")).toBe("+$30.00");
    expect(statValue("Gross P/L")).toBe("+$90.00");
  });
});

describe("the account filter scopes the whole page, not just the grid", () => {
  const ACC1 = account({ id: "acc-1", name: "Prop" });
  const ACC2 = account({ id: "acc-2", name: "Personal" });

  const trades = [
    mkTrade({ id: "p1", net: 100, accountId: "acc-1", closedAt: "2026-06-01T18:00:00Z" }),
    mkTrade({ id: "p2", net: 50, accountId: "acc-1", closedAt: "2026-06-02T18:00:00Z" }),
    mkTrade({ id: "s1", net: 500, accountId: "acc-2", closedAt: "2026-06-03T18:00:00Z" }),
  ];

  function renderIt() {
    return render(
      <Dashboard
        trades={rowsOf(trades)}
        accounts={[ACC1, ACC2]}
        todayKey="2026-06-03"
        timezone="America/New_York"
      />,
    );
  }

  it("shows every account's trades pooled, by default", () => {
    renderIt();
    expect(statValue("Trades")).toBe("3");
    expect(statValue("Net P/L")).toBe("+$650.00");
  });

  it("narrows to exactly one account's trades when selected", async () => {
    const user = userEvent.setup({ delay: null });
    renderIt();

    await user.click(accountSelect());
    await user.click(await screen.findByRole("option", { name: "Prop" }));

    expect(statValue("Trades")).toBe("2");
    expect(statValue("Net P/L")).toBe("+$150.00");
  });

  it("switching to the other account replaces the scope, not adds to it", async () => {
    const user = userEvent.setup({ delay: null });
    renderIt();

    await user.click(accountSelect());
    await user.click(await screen.findByRole("option", { name: "Personal" }));

    expect(statValue("Trades")).toBe("1");
    expect(statValue("Net P/L")).toBe("+$500.00");
  });
});

describe("the view-mode switcher reuses the /reports units layer, not a second design", () => {
  const ACCOUNT = account({ id: "acc-1" });
  const trades = [
    mkTrade({ id: "t1", net: 300, closedAt: "2026-06-01T18:00:00Z" }),
    mkTrade({ id: "t2", net: 350, closedAt: "2026-06-02T18:00:00Z" }),
  ];

  function renderIt() {
    return render(
      <Dashboard
        trades={rowsOf(trades)}
        accounts={[ACCOUNT]}
        todayKey="2026-06-03"
        timezone="America/New_York"
      />,
    );
  }

  it("Privacy masks Net P/L with the same mask /reports uses, not a blank tile", async () => {
    const user = userEvent.setup({ delay: null });
    renderIt();
    expect(statValue("Net P/L")).toBe("+$650.00");

    await user.click(screen.getByRole("button", { name: "Privacy" }));

    expect(statValue("Net P/L")).toBe("•••");
  });

  it("Percentage mode reads against current equity, not the raw dollar figure", async () => {
    const user = userEvent.setup({ delay: null });
    renderIt();
    const dollars = statValue("Net P/L");

    // Scoped to the switcher's own button group — a differently-styled "%"
    // badge lives elsewhere on the page (process adherence), and `{ name }`
    // alone matches both.
    const switcher = screen.getByRole("button", { name: "Privacy" }).parentElement!;
    await user.click(within(switcher).getByRole("button", { name: "%" }));

    const pct = statValue("Net P/L");
    expect(pct).toMatch(/%$/);
    expect(pct).not.toBe(dollars);
  });

  it("switching back to Dollars restores the tested +$ format", async () => {
    const user = userEvent.setup({ delay: null });
    renderIt();

    await user.click(screen.getByRole("button", { name: "Privacy" }));
    expect(statValue("Net P/L")).toBe("•••");
    await user.click(screen.getByRole("button", { name: "$" }));

    expect(statValue("Net P/L")).toBe("+$650.00");
  });

  it("R, Points, Ticks and Pips are disabled — a portfolio tile has no single instrument or planned risk to convert against", () => {
    renderIt();
    for (const label of ["R", "Points", "Ticks", "Pips"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("Max drawdown never gets a + sign, even in Dollars mode — it is a magnitude, not a signed P&L", () => {
    renderIt();
    expect(statValue("Max drawdown").startsWith("+")).toBe(false);
  });
});
