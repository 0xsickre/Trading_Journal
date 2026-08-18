import { describe, expect, it } from "vitest";
import { computeSickreScore } from "./sickre-score";
import { MIN_RADAR_AXES, canDrawRadar, radarAxes } from "./sickre-radar";

/**
 * The radar's honesty rules, tested where recharts cannot be reached.
 *
 * A spike against this repo's `ResponsiveContainer` mock found recharts renders
 * nothing at all in jsdom — no svg, no polygon, no axis ticks. So "which axes
 * did it draw" is unanswerable at the render layer, and these assertions are
 * the only place the rule is held. That is stated in `sickre-radar.ts` too; it
 * is worth saying twice, because the day the mock changes someone will wonder
 * why this file exists.
 */

/** Full marks all round, so every component counts unless a test drops one. */
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

describe("radarAxes", () => {
  it("plots every component that has a score", () => {
    const axes = radarAxes(scoreOf());
    expect(axes).toHaveLength(6);
    expect(axes.map((a) => a.key)).toEqual([
      "profitFactor",
      "avgWinLoss",
      "maxDrawdown",
      "winPct",
      "recovery",
      "consistency",
    ]);
  });

  it("adds the seventh axis when process adherence is supplied", () => {
    const axes = radarAxes(scoreOf({ processAdherencePct: 72 }));
    expect(axes).toHaveLength(7);
    expect(axes.at(-1)?.key).toBe("process");
  });

  it("OMITS a dropped component rather than plotting it at zero", () => {
    // The rule this module exists for. A vertex at the centre says "measured,
    // and terrible"; absence says "not measured". `sickre-score.ts` makes the
    // same distinction with "—" instead of 0 one level up.
    const axes = radarAxes(scoreOf({ recoveryFactor: null }));
    expect(axes).toHaveLength(5);
    expect(axes.map((a) => a.key)).not.toContain("recovery");
  });

  it("PLOTS a component that genuinely scored zero", () => {
    // The other half of the same rule: a real zero is a measurement and keeps
    // its axis, with the vertex at the centre where it belongs.
    const axes = radarAxes(scoreOf({ consistencyScore: 0 }));
    expect(axes.map((a) => a.key)).toContain("consistency");
    expect(axes.find((a) => a.key === "consistency")?.score).toBe(0);
  });

  it("keeps the score's own order, so the shape does not rearrange itself", () => {
    // Sorting by score would make the same book draw a different polygon every
    // time it improved — the one thing a shape must not do.
    const strong = radarAxes(scoreOf({ profitFactor: 1.0 }));
    const weak = radarAxes(scoreOf({ profitFactor: 2.6 }));
    expect(strong.map((a) => a.key)).toEqual(weak.map((a) => a.key));
  });

  it("shortens labels for the polar axis without touching the model", () => {
    const axes = radarAxes(scoreOf());
    expect(axes.find((a) => a.key === "profitFactor")?.label).toBe("Profit f.");
    // The score itself keeps the long label — the mentor pack quotes it.
    expect(
      scoreOf().components.find((c) => c.key === "profitFactor")?.label,
    ).toBe("Profit factor");
  });

  it("returns nothing at all for an empty book", () => {
    const empty = scoreOf({
      profitFactor: null,
      avgWinLossRatio: null,
      recoveryFactor: null,
      maxDrawdownPctOfPeakPnl: 0,
      winPct: 0,
      consistencyScore: 0,
      sample: { trades: 0, decided: 0 },
    });
    expect(radarAxes(empty)).toEqual([]);
  });
});

describe("canDrawRadar", () => {
  it("draws when there are enough axes and a headline number", () => {
    expect(canDrawRadar(scoreOf())).toBe(true);
  });

  it("refuses below the minimum — a triangle describes the gaps, not the book", () => {
    // Four components dropped leaves two axes. Sample stays high so the refusal
    // is the AXIS COUNT talking, not the evidence gate one level up.
    const thin = scoreOf({
      profitFactor: null,
      avgWinLossRatio: null,
      recoveryFactor: null,
      consistencyScore: null,
    });
    expect(radarAxes(thin).length).toBeLessThan(MIN_RADAR_AXES);
    expect(canDrawRadar(thin)).toBe(false);
  });

  it("refuses when the score itself is withheld, however many axes there are", () => {
    // Four trades: every component still computes, but the composite is
    // withheld for want of evidence. Drawing its shape anyway would restate a
    // claim the card just declined to make, in a form nobody can argue with.
    const provisionalButWithheld = scoreOf({
      sample: { trades: 4, decided: 4 },
    });
    expect(provisionalButWithheld.score).toBeNull();
    expect(canDrawRadar(provisionalButWithheld)).toBe(false);
  });

  it("draws for a thin-but-real sample, since that score IS stated", () => {
    const provisional = scoreOf({ sample: { trades: 10, decided: 10 } });
    expect(provisional.confidence.level).toBe("provisional");
    expect(canDrawRadar(provisional)).toBe(true);
  });
});
