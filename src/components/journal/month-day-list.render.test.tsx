import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthDayList } from "./month-day-list";
import type { MonthDayEntry } from "@/lib/journal/month-day-list";
import type { DailyReportListRow } from "@/lib/journal/daily-report-queries";
import type { PeriodRow } from "@/lib/journal/period-stats";

/**
 * The list earns its place by showing what the grid cannot: how the day felt,
 * which impulse was caught, whether it was written up and whether it is sealed.
 * These tests are about that content — the month's SHAPE is the grid's job and
 * is tested there.
 */

const journal = (over: Partial<DailyReportListRow> = {}): DailyReportListRow => ({
  report_date: "2026-04-07",
  mental_temp: 3,
  no_trade_day: false,
  impulse_fomo: false,
  impulse_fear: false,
  impulse_greed: false,
  impulse_fear_wrong: false,
  locked: false,
  hasNote: false,
  ...over,
});

const entry = (over: Partial<MonthDayEntry> = {}): MonthDayEntry => ({
  day: "2026-04-07",
  row: { key: "2026-04-07", net: 250, trades: 2 } as PeriodRow,
  journal: journal(),
  compliancePct: 80,
  ...over,
});

const list = (entries: MonthDayEntry[]) =>
  render(
    <MonthDayList
      monthKey="2026-04"
      currentMonth="2026-04"
      entries={entries}
      currency="USD"
    />,
  );

describe("MonthDayList", () => {
  it("shows the money, the temperature and the compliance on one line", () => {
    list([entry()]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/\+\$250/)).toBeInTheDocument();
    expect(within(row).getByText("2 trades")).toBeInTheDocument();
    expect(within(row).getByText("temp 3/5")).toBeInTheDocument();
    expect(within(row).getByText("80%")).toBeInTheDocument();
  });

  it("links each day to its own check-in", () => {
    list([entry()]);
    expect(screen.getByRole("link", { name: /Tue 07/ })).toHaveAttribute(
      "href",
      "/daily?date=2026-04-07",
    );
  });

  it("NAMES ONLY THE IMPULSES ACTUALLY TICKED", () => {
    // Four greyed-out labels on every row would make a clean day look as busy
    // as a bad one, and the list is scanned rather than read.
    list([entry({ journal: journal({ impulse_fomo: true, impulse_greed: true }) })]);
    expect(screen.getByText("FOMO")).toBeInTheDocument();
    expect(screen.getByText("Left money")).toBeInTheDocument();
    expect(screen.queryByText("Fear of losing")).not.toBeInTheDocument();
    expect(screen.queryByText("Fear of being wrong")).not.toBeInTheDocument();
  });

  it("SHOWS A DASH, NOT A ZERO, on a day that was written but not traded", () => {
    // The row is here because of the journal. Printing $0.00 would claim a flat
    // result was traded for — the distinction the whole list is built on.
    list([entry({ row: null, journal: journal({ no_trade_day: true }) })]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText(/\$0\.00/)).not.toBeInTheDocument();
    expect(within(row).getByText("No trade")).toBeInTheDocument();
  });

  it("leaves compliance blank rather than zero when no rule applied", () => {
    list([entry({ compliancePct: null })]);
    expect(screen.getByRole("listitem").textContent).not.toContain("0%");
  });

  it("still prints a measured zero per cent", () => {
    // The other half of the pair above: 0 % is a real verdict on a day rules
    // did apply to, and must not be swallowed by the "no rules" dash.
    list([entry({ compliancePct: 0 })]);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("marks a sealed day and a day carrying a note", () => {
    const { container } = list([
      entry({ journal: journal({ locked: true, hasNote: true }) }),
    ]);
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });

  it("KEEPS view=list ON EVERY MONTH LINK, so the arrows do not drop you back into the grid", () => {
    render(
      <MonthDayList monthKey="2026-03" currentMonth="2026-04" entries={[entry()]} currency="USD" />,
    );
    for (const name of ["Previous month", "Next month"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        expect.stringContaining("view=list"),
      );
    }
  });

  it("says so when the month holds nothing at all", () => {
    list([]);
    expect(screen.getByText(/Nothing traded and nothing written/)).toBeInTheDocument();
  });
});
