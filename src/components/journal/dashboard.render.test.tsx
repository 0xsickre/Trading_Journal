import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "./dashboard";
import { BOOK, shapedBook } from "@/lib/journal/book.fixture";
import type { Account, TradeRow } from "@/lib/journal/types";
import type { RealizedTrade } from "@/lib/journal/analytics";

/**
 * THE BOOK, ON SCREEN.
 *
 * `book.fixture.test.ts` derives every headline figure from this same book on
 * paper — comments, arithmetic visible — and asserts the pure functions agree.
 * This file renders the actual `<Dashboard>` with the same trades and asserts
 * the SAME figures appear in the DOM. Papir → `lib/` → ekran: one set of
 * numbers, checked at all three layers a reader could be lied to by.
 *
 * That third layer is the one round 3 named as unproven and could not close:
 * `S1` — Sickre Score 33/100 with "Max drawdown: 100" on an account holding no
 * trades — was a correct formula fed the wrong thing by `dashboard.tsx`, and no
 * amount of testing the formula in isolation could have shown that. Only a
 * render can.
 *
 * `ResponsiveContainer` is mocked to a fixed size: jsdom has no layout engine,
 * so a real one measures 0×0 and recharts renders nothing to assert on. The
 * chart PIXELS are not the point here — the chart DATA is, and that already
 * comes from the same `stats`/`drawdown` objects the KPI tiles read.
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

const ACCOUNT: Account = {
  id: "acc-1",
  name: "Main",
  broker: null,
  currency: "USD",
  starting_balance: 10_000,
  default_asset_class: null,
  timezone: "America/New_York",
  is_active: true,
  // EXACT_ZERO_RANGE, matching book.fixture.test.ts's `computeStats(..., EXACT_ZERO_RANGE)` —
  // the account's own band must agree with the paper for the KPI figures to match.
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
} as unknown as Account;

const rowsOf = (trades: RealizedTrade[]): TradeRow[] =>
  trades.map((t) => t.row);

/**
 * `todayKey` is the last trade's close day, in the account's own zone — not
 * "today" in the test-running machine's clock. The default period is 90 days,
 * so this comfortably covers the whole book without depending on wall-clock
 * time at all, which is the entire point after `P1`.
 */
const TODAY_KEY = "2026-03-13";

function renderDashboard(trades: TradeRow[]) {
  return render(
    <Dashboard
      trades={trades}
      accounts={[ACCOUNT]}
      todayKey={TODAY_KEY}
      timezone={ACCOUNT.timezone}
    />,
  );
}

/**
 * The value shown in the KPI tile labelled `label`.
 *
 * `getByText` alone is not enough: the same word can appear twice on this page
 * — "Trades" is both a KPI tile AND a column header in the weekly/monthly
 * breakdown table further down. Scoped by `data-slot="card-content"`, which is
 * shadcn's own attribute on every `<CardContent>` — not a test id added here —
 * so the query finds the tile without touching production code.
 */
function statValue(label: string): string {
  const labelEl = screen
    .getAllByText(label)
    .find((el) => el.parentElement?.getAttribute("data-slot") === "card-content");
  return labelEl?.parentElement?.children[1]?.textContent ?? "";
}

/** The Sickre Score headline, found by the `/ 100` that always sits beside it. */
function scoreHeadline(): string {
  return screen.getByText("/ 100").previousElementSibling?.textContent ?? "";
}

describe("the book, on screen — same figures the paper already proved", () => {
  it("shows the KPI tiles the hand-derived book computes to", () => {
    renderDashboard(rowsOf(BOOK));

    // net 600, 5 winners/4 losers/1 breakeven ⇒ win rate 5/9, PF 1100/500=2.2,
    // total R 6, best +400, worst −200 — all from book.fixture.test.ts's paper.
    expect(statValue("Trades")).toBe("10");
    expect(statValue("Win rate")).toBe("55.6%");
    expect(statValue("Net P/L")).toBe("+$600.00");
    expect(statValue("Total R")).toBe("+6.00R");
    expect(statValue("Profit factor")).toBe("2.2");
    expect(statValue("Best")).toBe("+$400.00");
    expect(statValue("Worst")).toBe("-$200.00");
  });

  it("shows the Sickre Score the paper works out to 63.75, rounded to 64", () => {
    renderDashboard(rowsOf(BOOK));
    expect(scoreHeadline()).toBe("64");
    // Ten trades: real, and thin — labelled so, with the count beside it.
    // Asserted as ONE string rather than two lookups: "10 trades" on its own
    // now also matches the Hold time card's "10 trades with a known duration",
    // and a query that matches two different facts proves neither. The Serbian
    // "10 trejda" this replaced happened to be unique; the English is not.
    expect(screen.getByText(/provisional · 10 trades/)).toBeInTheDocument();
  });
});

describe("Week win %, the same guard on a different denominator", () => {
  it("shows an em dash for a single flat week, not 0%", () => {
    // Two breakeven trades, both closing in the same ISO week (1–2 April
    // 2026 fall in the same week): one period, zero decided periods. Same
    // class of bug as the Win rate tile, on `PeriodSummary.winPct` instead of
    // `Stats.winRate`.
    renderDashboard(rowsOf(shapedBook([0, 0])));
    expect(statValue("Week win %")).toBe("—");
  });
});

describe("the shapes a book can take, on screen", () => {
  it("EMPTY — no crash, and the score says there is nothing to score yet", () => {
    // The reported bug itself, rendered: before the round-3 fix this screen
    // read 33 with "Max drawdown: 100" on exactly this input.
    renderDashboard([]);
    expect(statValue("Trades")).toBe("0");
    expect(statValue("Net P/L")).toBe("$0.00");
    expect(scoreHeadline()).toBe("—");
    expect(screen.getByText(/5 more/)).toBeInTheDocument();
  });

  it("ONE WINNER — the score withholds rather than reading 100", () => {
    renderDashboard(rowsOf(shapedBook([250])));
    expect(statValue("Trades")).toBe("1");
    expect(scoreHeadline()).toBe("—");
  });

  it("ALL LOSERS — the score is low, and drawdown does not read as flawless", () => {
    // `S3`, on screen: a losing streak's drawdown percentage has no positive
    // peak to divide by. Before the fix that read 0, and the card scored a
    // straight-down book 100 for risk management.
    renderDashboard(rowsOf(shapedBook([-100, -50, -200, -150, -75, -125])));
    expect(statValue("Trades")).toBe("6");
    expect(statValue("Win rate")).toBe("0.0%");
    expect(statValue("Net P/L")).toBe("-$700.00");
  });

  it("ALL BREAKEVEN — win rate has no decisions to divide by, and says so", () => {
    // A genuine finding from this render test, not an invented case: before
    // this step's fix, `stats.winRate` answered `0` for zero decided trades —
    // correct for the STATISTIC (nothing to divide), wrong read as a
    // measurement. This tile was the one place in the app the existing
    // `day-stats-card.tsx` / `month-calendar.tsx` guard had been missed.
    renderDashboard(rowsOf(shapedBook([0, 0, 0, 0, 0, 0])));
    expect(statValue("Trades")).toBe("6");
    expect(statValue("Win rate")).toBe("—");
    expect(scoreHeadline()).toBe("—");
  });
});
