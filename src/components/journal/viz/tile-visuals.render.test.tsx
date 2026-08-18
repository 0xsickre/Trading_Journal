import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  DonutRing,
  PROFIT_FACTOR_FULL,
  SemiGauge,
  Sparkline,
  SplitBar,
} from "./tile-visuals";

/**
 * The two invariants stated in `tile-visuals.tsx`, held here.
 *
 * These shapes live on a KPI tile whose value nine dashboard assertions compare
 * as an exact string, and whose reader takes in the shape before the digits. So
 * they must add NO text, and they must draw nothing at all when there is
 * nothing to draw — an empty gauge and a gauge pinned at zero mean opposite
 * things, and only one of them is a measurement.
 */

/** The fill path/circle, marked in the markup so the test need not guess. */
const fill = (c: HTMLElement) => c.querySelector("[data-viz-fill]");

describe("the visuals contribute no text", () => {
  it("renders not one character, whatever the input", () => {
    // `Stat` reads its value as `children[1].textContent`. These render outside
    // that node so they cannot reach it — but a `<title>` added here later
    // would still be announced beside a number that already says the same
    // thing, so the rule is asserted rather than merely arranged.
    const { container } = render(
      <>
        <SemiGauge pct={55.6} />
        <DonutRing value={2.2} full={PROFIT_FACTOR_FULL} />
        <SplitBar left={300} right={-100} />
        <Sparkline values={[1, 2, 3]} />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("SemiGauge", () => {
  it("draws a track and a fill when there is a percentage", () => {
    const { container } = render(<SemiGauge pct={50} />);
    expect(container.querySelector('[data-viz="semi-gauge"]')).toBeTruthy();
    expect(fill(container)).toBeTruthy();
  });

  it("draws the track and NO fill for null", () => {
    // An all-breakeven book has no decided trades to have won. The tile shows
    // "—" for that; this must not show a full-looking arc sitting at zero.
    const { container } = render(<SemiGauge pct={null} />);
    expect(container.querySelector('[data-viz="semi-gauge"]')).toBeTruthy();
    expect(fill(container)).toBeNull();
  });

  it("draws a fill of zero length at 0 % — present, but empty", () => {
    // Distinct from the null case above: the element EXISTS, which is what
    // separates "measured zero" from "no evidence" for anyone inspecting it.
    const { container } = render(<SemiGauge pct={0} />);
    const f = fill(container);
    expect(f).toBeTruthy();
    expect(f?.getAttribute("stroke-dasharray")?.startsWith("0 ")).toBe(true);
  });

  it("fills the whole arc at 100 %", () => {
    const { container } = render(<SemiGauge pct={100} />);
    const [dash, gap] = (fill(container)?.getAttribute("stroke-dasharray") ?? "")
      .split(" ")
      .map(Number);
    expect(gap).toBeCloseTo(0, 6);
    expect(dash).toBeGreaterThan(0);
  });
});

describe("DonutRing", () => {
  it("draws the track and no fill for null", () => {
    const { container } = render(
      <DonutRing value={null} full={PROFIT_FACTOR_FULL} />,
    );
    expect(container.querySelector('[data-viz="donut-ring"]')).toBeTruthy();
    expect(fill(container)).toBeNull();
  });

  it("closes the ring for Infinity — no losses is the maximum, not a gap", () => {
    // A book with winners and no losers has an infinite profit factor.
    // `scoreFromBands` already scores that as the top band; the ring agrees.
    const { container } = render(
      <DonutRing value={Infinity} full={PROFIT_FACTOR_FULL} />,
    );
    const [, gap] = (fill(container)?.getAttribute("stroke-dasharray") ?? "")
      .split(" ")
      .map(Number);
    expect(gap).toBeCloseTo(0, 6);
  });

  it("starts the arc at twelve o'clock", () => {
    const { container } = render(<DonutRing value={1} full={4} />);
    expect(fill(container)?.getAttribute("transform")).toContain("rotate(-90");
  });
});

describe("SplitBar", () => {
  it("splits the width in proportion to the two magnitudes", () => {
    const { container } = render(<SplitBar left={300} right={-100} />);
    const parts = container.querySelectorAll<HTMLElement>(
      '[data-viz="split-bar"] > div',
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].style.width).toBe("75%");
    expect(parts[1].style.width).toBe("25%");
  });

  it("renders nothing at all when one side has no data", () => {
    // A full green bar with no average loss behind it reads as "all winners"
    // when it means "not enough trades to say". Better to draw nothing.
    const { container } = render(<SplitBar left={300} right={null} />);
    expect(container.querySelector('[data-viz="split-bar"]')).toBeNull();
  });
});

describe("Sparkline", () => {
  it("draws a polyline through the series", () => {
    // Defaults are 120×28 with a 1.5 inset, so the usable band is y 1.5…26.5
    // and the midpoint is 14. The smallest value sits at the LARGEST y.
    const { container } = render(<Sparkline values={[0, 5, 10]} />);
    const line = container.querySelector("polyline");
    expect(line).toBeTruthy();
    expect(line?.getAttribute("points")).toBe("0,26.5 60,14 120,1.5");
  });

  it("renders nothing for an empty series", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector('[data-viz="sparkline"]')).toBeNull();
  });
});
