import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CalendarHeatmap } from "./calendar-heatmap";
import { ComplianceHeatmap } from "./compliance-heatmap";
import type { DayCompliance } from "@/lib/journal/tracker/compliance";

/**
 * TWO HEATMAPS, TWO DELIBERATELY DIFFERENT SCALES.
 *
 * `heatmap-grid.render.test.tsx` covers the grid — how many columns, which day
 * is last. What was not covered is COLOUR and TOOLTIP, and those are the only
 * two places these components state a number.
 *
 * The difference between them is the substance and is easily lost in an edit:
 *
 *   money      — a scale relative to the largest move in the window; the
 *                question is "which days moved the account", not "by how much
 *                in absolute terms";
 *   discipline — a fixed 0–100; 60 % has to look the same in a good month and
 *                a bad one, or a month of sixties would be dark green purely
 *                because nothing better happened.
 *
 * The test reads `title` attributes, because that is the text a user actually
 * sees on hover — the same number the book computes.
 */

const END = "2026-03-06";

function cellsByTitle(container: HTMLElement) {
  const map = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>("[title]")) {
    map.set(el.getAttribute("title") ?? "", el);
  }
  return map;
}

function titleFor(container: HTMLElement, dayKey: string): string | null {
  for (const el of container.querySelectorAll<HTMLElement>("[title]")) {
    const t = el.getAttribute("title") ?? "";
    if (t === dayKey || t.startsWith(`${dayKey}:`)) return t;
  }
  return null;
}

function bgFor(container: HTMLElement, dayKey: string): string {
  for (const el of container.querySelectorAll<HTMLElement>("[title]")) {
    const t = el.getAttribute("title") ?? "";
    if (t === dayKey || t.startsWith(`${dayKey}:`)) return el.style.backgroundColor;
  }
  return "";
}

describe("CalendarHeatmap — novac", () => {
  const daily = new Map<string, number>([
    ["2026-03-02", 1200],
    ["2026-03-03", -400],
    ["2026-03-04", 0],
    ["2026-03-05", 150],
  ]);

  it("the tooltip carries the amount with its sign and the account currency", () => {
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} currency="EUR" />,
    );
    expect(titleFor(container, "2026-03-02")).toBe("2026-03-02: +€1,200.00");
    expect(titleFor(container, "2026-03-03")).toBe("2026-03-03: -€400.00");
  });

  it("the currency is not hardcoded to dollars", () => {
    // `analytics.ts` used to hardcode `currency: "USD"`. This component takes
    // the account's currency, and that has to stay visible in the text.
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} currency="USD" />,
    );
    expect(titleFor(container, "2026-03-02")).toBe("2026-03-02: +$1,200.00");
  });

  it("a day with no trading carries only the date, not a zero", () => {
    // The difference between "I did not trade" and "I traded and finished flat"
    // is precisely what this whole project takes care not to confuse.
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} />,
    );
    expect(titleFor(container, "2026-03-01")).toBe("2026-03-01");
    // A traded day that finished flat DOES carry an amount — and without a
    // sign, because zero is neither a win nor a loss. `+$0.00` would file it
    // on one side.
    expect(titleFor(container, "2026-03-04")).toBe("2026-03-04: $0.00");
  });

  it("a flat day is muted, neither green nor red", () => {
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} />,
    );
    expect(bgFor(container, "2026-03-04")).toContain("--muted");
    expect(bgFor(container, "2026-03-01")).toContain("--muted");
  });

  it("a win pulls towards profit, a loss towards loss", () => {
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} />,
    );
    expect(bgFor(container, "2026-03-02")).toContain("--profit");
    expect(bgFor(container, "2026-03-03")).toContain("--loss");
  });

  it("the scale is RELATIVE to the largest move in the window", () => {
    // The same +150 day has to be darker when the largest move is smaller. Had
    // the scale been absolute, a quiet month would look empty.
    const at = (max: number) =>
      bgFor(
        render(
          <CalendarHeatmap
            daily={new Map([["2026-03-05", 150], ["2026-03-02", max]])}
            endDay={END}
            weeks={2}
          />,
        ).container,
        "2026-03-05",
      );
    const inLoudMonth = at(3000);
    const inQuietMonth = at(200);
    expect(inQuietMonth).not.toBe(inLoudMonth);
  });
});

describe("ComplianceHeatmap — disciplina", () => {
  const series: DayCompliance[] = [
    { date: "2026-03-02", pct: 100, satisfied: 5, applicable: 5 } as DayCompliance,
    { date: "2026-03-03", pct: 60, satisfied: 3, applicable: 5 } as DayCompliance,
    { date: "2026-03-04", pct: 0, satisfied: 0, applicable: 4 } as DayCompliance,
    { date: "2026-03-05", pct: null, satisfied: 0, applicable: 0 } as DayCompliance,
  ];

  it("the tooltip carries the percentage and the fraction it came from", () => {
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    expect(titleFor(container, "2026-03-02")).toBe("2026-03-02: 100% (5/5)");
    expect(titleFor(container, "2026-03-03")).toBe("2026-03-03: 60% (3/5)");
  });

  it("a day with no rules at all says no rules, not 0 %", () => {
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    expect(titleFor(container, "2026-03-05")).toBe("2026-03-05: no rules");
    expect(titleFor(container, "2026-03-01")).toBe("2026-03-01: no rules");
  });

  it("THE SCALE IS FIXED — 60 % looks the same whatever the rest of the window does", () => {
    // This is the difference that stops the discipline heatmap sharing a scale
    // with the money one. Normalising would repaint a month of straight
    // sixties as dark.
    const uzSavrsenDan = bgFor(
      render(<ComplianceHeatmap series={series} endDay={END} weeks={2} />)
        .container,
      "2026-03-03",
    );
    const bezSavrsenogDana = bgFor(
      render(
        <ComplianceHeatmap
          series={series.filter((d) => d.pct !== 100)}
          endDay={END}
          weeks={2}
        />,
      ).container,
      "2026-03-03",
    );
    expect(uzSavrsenDan).toBe(bezSavrsenogDana);
  });

  it("zero percent is visible, not muted", () => {
    // A day on which every rule was broken must not look like a day off.
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    const nula = bgFor(container, "2026-03-04");
    const bezPodataka = bgFor(container, "2026-03-05");
    expect(nula).toContain("--primary");
    expect(bezPodataka).toContain("--muted");
    expect(nula).not.toBe(bezPodataka);
  });

  it("does not use the money palette — green beside a P&L calendar would read as cash", () => {
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    for (const [title, el] of cellsByTitle(container)) {
      expect(el.style.backgroundColor, title).not.toContain("--profit");
      expect(el.style.backgroundColor, title).not.toContain("--loss");
    }
  });
});
