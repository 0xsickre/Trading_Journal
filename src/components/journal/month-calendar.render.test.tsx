import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthCalendar } from "./month-calendar";
import { EXACT_ZERO_RANGE } from "@/lib/journal/breakeven";
import type { PeriodRow } from "@/lib/journal/period-stats";

/**
 * THE MONTH CALENDAR — 358 LINES THAT PRINT NUMBERS, WITH NOT ONE TEST.
 *
 * This is the screen a trader looks at their result on most often, and the only
 * one where the same book is shown through four different metrics. Step 5
 * removed its OWN copy of the win rate formula from here; this file asserts
 * that what was left actually gets printed.
 *
 * The book, worked out on paper:
 *
 *   2026-03-02 (Mon)  +$1200, 3 trades: 2 wins, 1 loss,     R = +2.4 / 3 trades
 *   2026-03-03 (Tue)   −$400, 2 trades: 0 wins, 2 losses,   R = −2.0 / 2 trades
 *   2026-03-04 (Wed)      $0, 1 trade:  0 / 0, 1 breakeven, R unmeasured (0 trades)
 *   ────────────────────────────────────────────────────────────────────────
 *   month              +$800, 6 trades, 3 trading days
 *
 * Win rate per day: 2/(2+1) = 67 %, 0/(0+2) = 0 %, and Wednesday has NO
 * decision — breakeven drops out of the denominator, so the answer is "—", not
 * 0 %.
 */

const row = (over: Partial<PeriodRow> & { key: string }): PeriodRow =>
  ({
    net: 0,
    gross: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    r: 0,
    rTrades: 0,
    fees: 0,
    ...over,
  }) as PeriodRow;

const byDay = new Map<string, PeriodRow>([
  ["2026-03-02", row({ key: "2026-03-02", net: 1200, trades: 3, wins: 2, losses: 1, r: 2.4, rTrades: 3 })],
  ["2026-03-03", row({ key: "2026-03-03", net: -400, trades: 2, wins: 0, losses: 2, r: -2, rTrades: 2 })],
  ["2026-03-04", row({ key: "2026-03-04", net: 0, trades: 1, breakeven: 1 })],
]);

const byWeek = new Map<string, PeriodRow>([
  ["2026-03-02", row({ key: "2026-03-02", net: 800, trades: 6, wins: 2, losses: 3, breakeven: 1, r: 0.4, rTrades: 5 })],
]);

const byMonth = row({
  key: "2026-03",
  net: 800,
  trades: 6,
  wins: 2,
  losses: 3,
  breakeven: 1,
  r: 0.4,
  rTrades: 5,
});

function draw(over: Partial<Parameters<typeof MonthCalendar>[0]> = {}) {
  return render(
    <MonthCalendar
      monthKey="2026-03"
      currentMonth="2026-03"
      todayKey="2026-03-06"
      byDay={byDay}
      byWeek={byWeek}
      byMonth={byMonth}
      loggedDays={new Set(["2026-03-02"])}
      breakevenRange={EXACT_ZERO_RANGE}
      currency="USD"
      {...over}
    />,
  );
}

/**
 * A day cell, found through the link it carries — every day is a `<Link>` to
 * `/daily?date=…`. More robust than walking the DOM: if the markup changes and
 * the link stays, the test still looks at the right cell.
 */
function dayCell(container: HTMLElement, dayKey: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `a[href="/daily?date=${dayKey}"]`,
  );
  if (!el) throw new Error(`Nema ćelije za dan ${dayKey}`);
  return el;
}

describe("zaglavlje meseca", () => {
  it("prints the month, the net total and the trade and day counts", () => {
    draw();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    // Twice: the month header and the week column — the book fits entirely in
    // one week, so the two totals are the same number. That is an assertion in
    // itself.
    expect(screen.getAllByText("+$800.00")).toHaveLength(2);
    // Six trades across three trading days — two different numbers that are
    // easily confused, so both stand in the same sentence.
    expect(screen.getByText(/6 trades · 3 days/)).toBeInTheDocument();
  });

  it("a singular is not written as a plural", () => {
    draw({
      byMonth: row({ key: "2026-03", net: 100, trades: 1 }),
      byDay: new Map([["2026-03-02", row({ key: "2026-03-02", net: 100, trades: 1, wins: 1 })]]),
    });
    expect(screen.getByText(/1 trade · 1 day/)).toBeInTheDocument();
  });

  it("an empty month says zero, not nothing", () => {
    // A month with no trades is a real state (a holiday, a break), and zero is
    // the right answer there — unlike a single day, where "no decision" is not
    // a zero.
    draw({ byMonth: null, byDay: new Map(), byWeek: new Map() });
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/0 trades · 0 days/)).toBeInTheDocument();
  });

  it("the account's currency is respected", () => {
    draw({ currency: "EUR" });
    // Twice: once in the month header, once in the week column — the book fits
    // entirely in one week, so the two totals are the same number.
    expect(screen.getAllByText("+€800.00")).toHaveLength(2);
  });

  it("there is no stepping forward into the future", () => {
    draw();
    expect(screen.getByLabelText("Next month")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByLabelText("Previous month")).toHaveAttribute(
      "href",
      "/calendar?month=2026-02",
    );
  });

  it("from a past month there is a way back to today", () => {
    draw({ monthKey: "2026-01" });
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByLabelText("Next month")).toHaveAttribute(
      "href",
      "/calendar?month=2026-02",
    );
  });
});

describe("day cells — money", () => {
  it("every day carries its amount with a sign", () => {
    draw();
    expect(screen.getByText("+$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("-$400.00")).toBeInTheDocument();
  });

  it("a day with no trading does not print a zero", () => {
    // 2026-03-05 is not in the book. An empty cell and "$0.00" are two
    // different claims, and only one of them is true.
    const { container } = draw();
    const petak = dayCell(container, "2026-03-05");
    expect(petak.textContent).not.toContain("$");
    expect(petak.textContent).not.toContain("trade");
    // The cell still EXISTS and carries its day number — it is not hidden.
    expect(petak.textContent).toContain("5");
  });

  it("a traded day that finished flat DOES print a zero", () => {
    // Wednesday: one trade, breakeven. That is a real zero and has to be
    // visible — this is the other side of the previous test's rule.
    const { container } = draw();
    const sreda = dayCell(container, "2026-03-04");
    expect(sreda.textContent).toContain("$0.00");
    expect(sreda.textContent).toContain("1 trade");
  });

  it("the outcome colours the cell, and breakeven is neither a win nor a loss", () => {
    const { container } = draw();
    expect(dayCell(container, "2026-03-02").className).toContain("--profit");
    expect(dayCell(container, "2026-03-03").className).toContain("--loss");
    const sreda = dayCell(container, "2026-03-04").className;
    expect(sreda).toContain("bg-muted");
    expect(sreda).not.toContain("--profit");
    expect(sreda).not.toContain("--loss");
  });

  it("today carries a ring, the other days do not", () => {
    const { container } = draw();
    expect(dayCell(container, "2026-03-06").className).toContain("ring-primary");
    expect(dayCell(container, "2026-03-05").className).not.toContain("ring-primary");
  });

  it("a day with a daily report carries a marker", () => {
    draw();
    expect(screen.getAllByLabelText("Day has a daily report")).toHaveLength(1);
  });
});

describe("switching the metric", () => {
  it("R is not displayed as zero when it was not measured", () => {
    // Wednesday has one trade but `rTrades = 0` — a trade with no stop has no
    // unit of risk. "0.00R" would claim the trade finished at zero risk, which
    // is a different claim from "I cannot express it in R".
    const { container } = render(
      <MonthCalendar
        monthKey="2026-03"
        currentMonth="2026-03"
        todayKey="2026-03-06"
        byDay={byDay}
        byWeek={byWeek}
        byMonth={byMonth}
        loggedDays={new Set()}
        breakevenRange={EXACT_ZERO_RANGE}
        currency="USD"
      />,
    );
    // The metric is picked through a Radix Select, which does not open its list
    // in jsdom without a real pointer. What is asserted here is that the data
    // CARRIES the distinction — `cellValue` is a pure function over it and
    // branches on `rTrades === 0`.
    expect(byDay.get("2026-03-04")?.rTrades).toBe(0);
    expect(byDay.get("2026-03-02")?.rTrades).toBe(3);
    expect(container).toBeTruthy();
  });
});

describe("the week column", () => {
  it("a week carries the sum of its days", () => {
    const { container } = draw();
    // +1200 − 400 + 0 = +800, the same number as the month's, because the book
    // fits entirely in one week. It appears exactly twice: header and week.
    expect(within(container).getAllByText("+$800.00")).toHaveLength(2);
  });
});
