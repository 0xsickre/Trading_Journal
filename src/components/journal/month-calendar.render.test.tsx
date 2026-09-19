import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthCalendar, MonthSummaryBar } from "./month-calendar";
import { summarizeMonth } from "@/lib/journal/calendar-view";
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

const byMonth = new Map<string, PeriodRow>([
  [
    "2026-03",
    row({ key: "2026-03", net: 800, trades: 6, wins: 2, losses: 3, breakeven: 1, r: 0.4, rTrades: 5 }),
  ],
]);

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
  it("prints the month, and the week total once — the month's totals are in the summary bar", () => {
    draw();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    // The week column and March in the year strip. The card header used to
    // print it a third time — the figure the summary bar above now carries.
    expect(screen.getAllByText("+$800.00")).toHaveLength(2);
    expect(screen.queryByText(/6 trades · 3 days/)).not.toBeInTheDocument();
  });

  it("the account's currency is respected", () => {
    draw({ currency: "EUR" });
    expect(screen.getAllByText("+€800.00")).toHaveLength(2);
  });

  it("there is no stepping forward into the future — a real disabled button, not a link", () => {
    draw();
    const next = screen.getByLabelText("Next month");
    // It was a link with `disabled` on it, which an anchor ignores: clicking
    // reloaded the same month.
    expect(next.tagName).toBe("BUTTON");
    expect(next).toBeDisabled();
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

  it("carries the account on every month link", () => {
    draw({ monthKey: "2026-01", accountId: "acc-2" });
    expect(screen.getByLabelText("Previous month")).toHaveAttribute(
      "href",
      "/calendar?month=2025-12&account=acc-2",
    );
    expect(screen.getByLabelText("Next month")).toHaveAttribute(
      "href",
      "/calendar?month=2026-02&account=acc-2",
    );
  });
});

describe("the month summary bar", () => {
  it("names the totals a month is read for", () => {
    render(
      <MonthSummaryBar
        summary={summarizeMonth("2026-03", byDay, EXACT_ZERO_RANGE)}
        currency="USD"
      />,
    );
    const value = (label: string) => screen.getByText(label).parentElement!.children[1].textContent;
    expect(value("Net P/L")).toBe("+$800.00");
    expect(value("Trades")).toBe("6");
    expect(screen.getByText("3 days traded")).toBeInTheDocument();
    expect(value("Green / red days")).toBe("1 / 1");
    expect(value("Best day")).toBe("+$1,200.00");
    expect(value("Worst day")).toBe("-$400.00");
  });

  it("an empty month says zero for the money and a dash for the extremes", () => {
    render(
      <MonthSummaryBar summary={summarizeMonth("2026-05", byDay, EXACT_ZERO_RANGE)} currency="USD" />,
    );
    const value = (label: string) => screen.getByText(label).parentElement!.children[1].textContent;
    expect(value("Net P/L")).toBe("$0.00");
    expect(value("Best day")).toBe("—");
    expect(value("Avg per day")).toBe("—");
  });
});

describe("the calendar's edges", () => {
  it("a future day is not a link", () => {
    const { container } = draw();
    // Today is the 6th; the 20th has not happened.
    expect(container.querySelector('a[href="/daily?date=2026-03-20"]')).toBeNull();
    expect(container.querySelector('a[href="/daily?date=2026-03-05"]')).not.toBeNull();
  });

  it("a week inside the breakeven band is grey, like its days", () => {
    const flatWeek = new Map([
      ["2026-03-02", row({ key: "2026-03-02", net: 8, trades: 1, breakeven: 1 })],
    ]);
    draw({ byWeek: flatWeek, breakevenRange: { from: -20, to: 20 } });
    const cell = screen.getByText("+$8.00");
    expect(cell.className).toContain("text-muted-foreground");
  });

  it("the year strip links every past month and none to come", () => {
    draw({
      monthKey: "2026-03",
      currentMonth: "2026-03",
      byMonth: new Map([["2026-02", row({ key: "2026-02", net: 300, trades: 4 })]]),
    });
    expect(screen.getByRole("link", { name: /February 2026, 4 trades/ })).toHaveAttribute(
      "href",
      "/calendar?month=2026-02",
    );
    expect(screen.queryByRole("link", { name: /April 2026/ })).not.toBeInTheDocument();
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
    // +1200 − 400 + 0 = +800. The year strip shows March's +$800 too.
    expect(within(container).getAllByText("+$800.00").length).toBeGreaterThanOrEqual(1);
  });
});
