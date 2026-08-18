import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SickreScoreCard } from "./sickre-score-card";
import { computeSickreScore } from "@/lib/journal/sickre-score";

/**
 * The first test in this repository that RENDERS anything.
 *
 * Round 3 closed with one gap stated openly: 16 250 lines of components and 25
 * routes reviewed by reading, never by running — and the defect the owner found
 * himself lived there. This file is the proof that the gap can be closed: a
 * component, mounted in jsdom, asserted on what a reader would actually see.
 *
 * `sickre-score-card.tsx` is the smoke test on purpose. It is pure presentation
 * — no `next/navigation`, no server action, no chart, no Radix — so a failure
 * here means the harness is wrong, not the component. Everything else in the
 * phase builds on this working.
 */

/** The card takes a computed score, so the fixture goes through the real one. */
const scoreOf = (over: Partial<Parameters<typeof computeSickreScore>[0]> = {}) =>
  computeSickreScore({
    profitFactor: 2.2,
    avgWinLossRatio: 1.76,
    maxDrawdownPctOfPeakPnl: 40,
    winPct: 55.5556,
    recoveryFactor: 3,
    consistencyScore: 68.64,
    sample: { trades: 40, decided: 40 },
    ...over,
  });

/** The headline number, found by the `/ 100` that always sits beside it. */
const headline = () =>
  screen.getByText("/ 100").previousElementSibling?.textContent ?? "";

/** The value of the component row labelled `label`, as the reader sees it. */
function componentValue(label: string): string {
  const row = screen.getByText(label).parentElement;
  // label · bar · value · weight — the value is the third child.
  return row?.children[2]?.textContent ?? "";
}

describe("the score card renders what the score says", () => {
  it("shows the headline number rounded, and the weights", () => {
    render(<SickreScoreCard score={scoreOf()} />);
    // 80×25 + 20×20 + 60×20 + 92.59×15 + 70×10 + 68.64×10 over 100 → 63.75.
    expect(headline()).toBe("64");
    expect(componentValue("Profit factor")).toBe("80");
    expect(componentValue("Max drawdown")).toBe("60");
  });

  it("shows an em dash for a component with no data, never a zero", () => {
    // The whole point of `S1`: a dropped component must not read as a bad one.
    render(<SickreScoreCard score={scoreOf({ recoveryFactor: null })} />);
    expect(componentValue("Recovery factor")).toBe("—");
  });

  it("withholds the score on an empty book and says how far off it is", () => {
    // `S1` itself, asserted at the layer where it was seen. Before the fix this
    // card read 33 with "Max drawdown: 100" on exactly these inputs.
    render(
      <SickreScoreCard
        score={scoreOf({
          profitFactor: null,
          avgWinLossRatio: null,
          recoveryFactor: null,
          maxDrawdownPctOfPeakPnl: 0,
          winPct: 0,
          consistencyScore: 0,
          sample: { trades: 0, decided: 0 },
        })}
      />,
    );
    // Every one of the seven components reads "—" here, which is why the
    // headline has to be found by position rather than by its text.
    expect(headline()).toBe("—");
    expect(screen.getByText(/5 more/)).toBeInTheDocument();
    expect(componentValue("Max drawdown")).toBe("—");
    // Six components here, not seven: this fixture supplies no process
    // adherence, so the card omits that row entirely rather than showing it
    // empty. Six dashes plus the headline.
    expect(screen.getAllByText("—")).toHaveLength(7);
  });

  it("marks a thin sample as provisional, with the count beside it", () => {
    render(<SickreScoreCard score={scoreOf({ sample: { trades: 10, decided: 10 } })} />);
    expect(screen.getByText(/provisional/)).toBeInTheDocument();
    expect(screen.getByText(/10 trades/)).toBeInTheDocument();
  });
});

/**
 * The radar half, asserted through the card's OWN markup.
 *
 * Not through recharts: a spike against this repo's `ResponsiveContainer` mock
 * found it renders nothing at all in jsdom — no svg, no polygon, no axis ticks,
 * just an empty `.recharts-wrapper`. Which axes the polygon actually has is
 * therefore proved in `sickre-radar.test.ts`, where it is pure arithmetic. What
 * IS checkable here is everything the card says around the chart, and that is
 * the part a reader relies on to interpret the shape.
 */
describe("the radar, and what the card says around it", () => {
  it("states how many components the shape is built from", () => {
    render(<SickreScoreCard score={scoreOf()} />);
    // A polygon missing two corners looks like a shape, not like a gap, unless
    // something says so.
    expect(
      screen.getByText(/6 of 6 components · 100 of 100 weights/),
    ).toBeInTheDocument();
  });

  it("refuses the radar below four axes and says why", () => {
    // Three components dropped, chosen so 65 of 100 weights survive — past
    // `MIN_COVERAGE_SHARE`, so the score is still stated and it is the AXIS
    // COUNT alone doing the refusing.
    render(
      <SickreScoreCard
        score={scoreOf({
          recoveryFactor: null,
          consistencyScore: null,
          winPct: null,
        })}
      />,
    );
    expect(screen.getByText(/would describe the gaps/)).toBeInTheDocument();
    expect(screen.queryByText(/components · /)).not.toBeInTheDocument();
  });

  it("keeps the weights and the renormalization note, folded but present", () => {
    // The two facts a radar structurally cannot carry: that profit factor is a
    // quarter of the score, and that a dropped component renormalizes the rest.
    render(<SickreScoreCard score={scoreOf({ recoveryFactor: null })} />);
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/renormalized/)).toBeInTheDocument();
  });
});

describe("the breakdown opens itself exactly when it is needed", () => {
  const details = (): HTMLDetailsElement =>
    document.querySelector("details") as HTMLDetailsElement;

  it("stays folded on a settled score", () => {
    render(<SickreScoreCard score={scoreOf()} />);
    expect(details().open).toBe(false);
  });

  it("opens on a provisional score", () => {
    // A reader handed a shaky number should not have to go looking for the
    // reason it is shaky.
    render(<SickreScoreCard score={scoreOf({ sample: { trades: 10, decided: 10 } })} />);
    expect(details().open).toBe(true);
  });

  it("opens when the score is withheld altogether", () => {
    render(
      <SickreScoreCard score={scoreOf({ sample: { trades: 0, decided: 0 } })} />,
    );
    expect(details().open).toBe(true);
  });
});
