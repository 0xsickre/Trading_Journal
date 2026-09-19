import { describe, expect, it } from "vitest";
import { calendarHref, summarizeMonth, yearMonths } from "./calendar-view";
import type { PeriodRow } from "./period-stats";

function row(key: string, net: number, trades = 1): PeriodRow {
  return {
    key,
    net,
    gross: net,
    trades,
    wins: net > 0 ? 1 : 0,
    losses: net < 0 ? 1 : 0,
    breakeven: net === 0 ? 1 : 0,
    r: 0,
    rTrades: 0,
    fees: 0,
    volume: trades,
  };
}

describe("calendarHref", () => {
  it("keeps every parameter the reader had, and drops defaults", () => {
    expect(calendarHref({ month: "2026-03", view: "list", account: "acc-1" })).toBe(
      "/calendar?month=2026-03&view=list&account=acc-1",
    );
    expect(calendarHref({ month: "2026-03" })).toBe("/calendar?month=2026-03");
    expect(calendarHref({ account: "all" })).toBe("/calendar");
  });
});

describe("summarizeMonth", () => {
  const byDay = new Map(
    [row("2026-03-02", 300, 2), row("2026-03-03", -100), row("2026-03-04", 10), row("2026-02-27", 999)].map(
      (r) => [r.key, r],
    ),
  );

  it("sums only the month's own days", () => {
    const s = summarizeMonth("2026-03", byDay, { from: 0, to: 0 });
    expect(s.net).toBe(210);
    expect(s.trades).toBe(4);
    expect(s.tradingDays).toBe(3);
    expect(s.best?.key).toBe("2026-03-02");
    expect(s.worst?.key).toBe("2026-03-03");
    expect(s.avgPerDay).toBe(70);
  });

  it("counts green and red days through the breakeven band", () => {
    const s = summarizeMonth("2026-03", byDay, { from: -20, to: 20 });
    expect(s.greenDays).toBe(1);
    expect(s.redDays).toBe(1);
  });

  it("has no average and no extremes for an empty month", () => {
    const s = summarizeMonth("2026-05", byDay, { from: 0, to: 0 });
    expect(s).toMatchObject({ net: 0, tradingDays: 0, best: null, worst: null, avgPerDay: null });
  });
});

describe("yearMonths", () => {
  it("lists January to December and marks the months still to come", () => {
    const months = yearMonths("2026-03", new Map([["2026-02", row("2026-02", 50)]]), "2026-04");
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe("2026-01");
    expect(months[1].row?.net).toBe(50);
    expect(months[3].future).toBe(false);
    expect(months[4].future).toBe(true);
  });
});
