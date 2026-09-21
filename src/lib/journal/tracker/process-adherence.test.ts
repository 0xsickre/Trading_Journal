import { describe, expect, it } from "vitest";
import { processAdherence, PROCESS_BLEND } from "./process-adherence";
import { computeScorecard } from "../scorecard";

/** Everything the scorecard needs beyond the two process halves. */
const base = {
  maxDrawdownPctOfEquity: 20,
  underWaterDays: 0,
  decidedRs: [1, -1, 1, 1, -1, 1, 1, -1],
  trades: 30,
};

describe("processAdherence", () => {
  it("is null when neither signal exists", () => {
    // An unmeasured process is not a bad one. The score drops the component and
    // renormalizes rather than scoring a new trader at zero.
    expect(processAdherence({ trackerPct: null, followRatePct: null })).toBeNull();
  });

  it("returns the surviving signal UNSCALED when the other is missing", () => {
    // "The other × its weight" would score a flawless tracker with no playbook
    // answers at 60/100 and call that a process problem.
    expect(processAdherence({ trackerPct: 100, followRatePct: null })).toBe(100);
    expect(processAdherence({ trackerPct: null, followRatePct: 80 })).toBe(80);
  });

  it("weights the tracker above the follow rate when both exist", () => {
    expect(processAdherence({ trackerPct: 100, followRatePct: 50 })).toBe(80);
    expect(processAdherence({ trackerPct: 50, followRatePct: 100 })).toBe(70);
  });

  it("respects a custom blend", () => {
    expect(
      processAdherence({ trackerPct: 100, followRatePct: 0 }, { tracker: 50, follow: 50 }),
    ).toBe(50);
  });

  it("counts zero as a score, never as missing data", () => {
    // A truthiness check here would reward total non-compliance by dropping the
    // component. This is the assertion that pins that.
    expect(processAdherence({ trackerPct: 0, followRatePct: 0 })).toBe(0);
    expect(processAdherence({ trackerPct: 0, followRatePct: null })).toBe(0);

    const card = computeScorecard({ ...base, trackerPct: 0, followRatePct: 0 });
    expect(card.process.score).toBe(0);
  });

  it("keeps the documented blend as data, not as a magic number", () => {
    expect(PROCESS_BLEND.tracker + PROCESS_BLEND.follow).toBe(100);
  });
});

describe("process on the scorecard", () => {
  it("stands on its own axis, unblended with any outcome", () => {
    // The composite it used to be the heaviest component of is gone. There is
    // no weight to be heaviest of any more: Process is a number in its own
    // right, and nothing about the account's results can move it.
    const card = computeScorecard({ ...base, trackerPct: 90, followRatePct: 50 });
    expect(card.process.score).toBeCloseTo(74, 10);

    const worse = computeScorecard({
      ...base,
      trackerPct: 90,
      followRatePct: 50,
      maxDrawdownPctOfEquity: 60,
      decidedRs: [-1, -1, -1, -1, -1, -1],
    });
    expect(worse.process.score).toBe(card.process.score);
    expect(worse.survival.score!).toBeLessThan(card.survival.score!);
  });

  it("is measured on a book with nothing closed, where no outcome can be", () => {
    const card = computeScorecard({
      ...base,
      trades: 0,
      decidedRs: [],
      trackerPct: 100,
      followRatePct: null,
    });
    expect(card.process.score).toBe(100);
    expect(card.survival.score).toBeNull();
    expect(card.edge.expectancyR).toBeNull();
  });
});
