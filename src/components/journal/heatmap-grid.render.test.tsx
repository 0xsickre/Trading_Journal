import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeatmapGrid } from "./heatmap-grid";
import { CalendarHeatmap } from "./calendar-heatmap";
import { ComplianceHeatmap } from "./compliance-heatmap";
import type { DayCompliance } from "@/lib/journal/tracker/compliance";

/**
 * The grid's own doc comment names the bug this file exists to re-prove: it
 * used to end at `new Date()` read through local getters — the BROWSER's day
 * — while every key in the data is a day in the ACCOUNT's timezone. `endDay`
 * is now the only thing that anchors the last column, and nothing below ever
 * constructs a `Date` from the current instant.
 */
describe("HeatmapGrid — endDay anchors the grid, nothing else does", () => {
  it("renders weeks × 7 cells, the last one keyed to endDay itself", () => {
    render(
      <HeatmapGrid
        values={new Map([["2026-03-13", 5]])}
        endDay="2026-03-13"
        weeks={4}
        color={() => "red"}
        title={(c) => c.key}
      />,
    );
    // 4 weeks × 7 days, one cell per day key as its title.
    expect(document.querySelectorAll("[title]")).toHaveLength(28);
    expect(screen.getByTitle("2026-03-13")).toBeInTheDocument();
  });

  it("moving endDay a full week forward shifts the window by exactly a week, same weekday either side", () => {
    // Both Fridays, so the ISO-week alignment `heatmapWindow` applies is
    // identical on both sides — the only thing that can move the window is
    // `endDay` itself.
    const { rerender } = render(
      <HeatmapGrid values={new Map()} endDay="2026-03-06" weeks={1} color={() => "red"} title={(c) => c.key} />,
    );
    expect(screen.getByTitle("2026-03-06")).toBeInTheDocument();
    expect(screen.queryByTitle("2026-03-13")).not.toBeInTheDocument();

    rerender(
      <HeatmapGrid values={new Map()} endDay="2026-03-13" weeks={1} color={() => "red"} title={(c) => c.key} />,
    );
    expect(screen.getByTitle("2026-03-13")).toBeInTheDocument();
  });

  it("a day missing from the map reaches the color callback as null, not zero", () => {
    const seen: (number | null)[] = [];
    render(
      <HeatmapGrid
        values={new Map([["2026-03-13", 10]])}
        endDay="2026-03-13"
        weeks={1}
        color={(v) => {
          seen.push(v);
          return "red";
        }}
        title={(c) => c.key}
      />,
    );
    expect(seen).toContain(null);
    expect(seen).toContain(10);
    expect(seen).not.toContain(0);
  });
});

describe("CalendarHeatmap — profit/loss tint, not a fixed palette", () => {
  it("tints a positive day with the profit token and a negative day with the loss token", () => {
    const daily = new Map([
      ["2026-03-11", 500],
      ["2026-03-12", -300],
      ["2026-03-13", 0],
    ]);
    render(<CalendarHeatmap daily={daily} endDay="2026-03-13" weeks={1} currency="USD" />);

    const win = screen.getByTitle(/2026-03-11.*\+\$500\.00/);
    const loss = screen.getByTitle(/2026-03-12.*-\$300\.00/);
    // Present in the map at exactly 0 — a real flat day, not "no data" (that
    // case is the next uncharted cell, which carries no title text at all).
    const flat = screen.getByTitle("2026-03-13: $0.00");

    expect((win as HTMLElement).style.backgroundColor).toContain("--profit");
    expect((loss as HTMLElement).style.backgroundColor).toContain("--loss");
    // A flat day is neither a win nor a loss — muted, not green-at-zero-intensity.
    expect((flat as HTMLElement).style.backgroundColor).toBe("var(--muted)");
  });
});

describe("ComplianceHeatmap — fixed 0–100 scale, one hue", () => {
  const day = (over: Partial<DayCompliance> & { date: string }): DayCompliance => ({
    applicable: 4,
    satisfied: 3,
    pct: 75,
    status: "broken",
    missedRuleIds: [],
    unansweredRuleIds: [],
    ...over,
  });

  it("shows satisfied/applicable in the tooltip for a scored day", () => {
    const series = [day({ date: "2026-03-13", pct: 75, satisfied: 3, applicable: 4 })];
    render(<ComplianceHeatmap series={series} endDay="2026-03-13" weeks={1} />);
    expect(screen.getByTitle("2026-03-13: 75% (3/4)")).toBeInTheDocument();
  });

  it("a day with no applicable rule reads 'no rules', not 0%", () => {
    const series = [
      day({ date: "2026-03-13", pct: null, satisfied: 0, applicable: 0, status: "skipped" }),
    ];
    render(<ComplianceHeatmap series={series} endDay="2026-03-13" weeks={1} />);
    expect(screen.getByTitle("2026-03-13: no rules")).toBeInTheDocument();
  });

  it("a genuine 0% day is the faintest primary, not muted like a no-data day", () => {
    const series = [day({ date: "2026-03-13", pct: 0, satisfied: 0, applicable: 4 })];
    render(<ComplianceHeatmap series={series} endDay="2026-03-13" weeks={1} />);
    const cell = screen.getByTitle("2026-03-13: 0% (0/4)") as HTMLElement;
    expect(cell.style.backgroundColor).toContain("--primary");
    expect(cell.style.backgroundColor).not.toBe("var(--muted)");
  });
});
